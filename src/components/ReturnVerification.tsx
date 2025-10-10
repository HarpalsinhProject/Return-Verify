
// src/components/ReturnVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo, useRef, useEffect } from "react"; // Added useRef and useEffect
import * as XLSX from "xlsx";
import type { Range } from "xlsx";
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download, Package, Info, FileSpreadsheet, Filter, X, History } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils"; // Import cn for conditional classes


interface ReturnItem {
  awb: string;
  suborderId?: string;
  sku?: string;
  category?: string;
  qty?: string;
  size?: string;
  returnReason?: string;
  returnShippingFee?: string | number;
  deliveredOn?: string | number | Date;
  courierPartner?: string;
  returnType?: string; // RTO or Customer Return
  received: boolean;
}

type VerificationStatus = 'success' | 'error' | 'info' | 'idle';

const HIGHLIGHT_REASON_KEYWORDS = [
    "wrong",
    "defective",
    "stain", // Match "stains"
    "damage", // Match "damaged"
    "torn",
    "incomplete",
    "missing"
];

const shouldHighlightReason = (reason?: string): boolean => {
    if (!reason) return false;
    const lowerReason = reason.toLowerCase().trim();
    return HIGHLIGHT_REASON_KEYWORDS.some(keyword => lowerReason.includes(keyword));
};

const shouldHighlightQty = (qty?: string): boolean => {
    if (!qty) return false;
    const numQty = parseInt(qty, 10);
    return !isNaN(numQty) && numQty > 1;
};

const playSound = (soundFileUrl: string) => {
  if (typeof window !== 'undefined') { // Ensure this only runs on the client
    try {
      const audio = new Audio(soundFileUrl);
      audio.play().catch(error => {
        console.warn(`Could not play sound ${soundFileUrl}:`, error);
      });
    } catch (e) {
      console.warn(`Error initializing Audio for ${soundFileUrl}:`, e);
    }
  }
};

const formatDate = (dateInput: string | number | Date | undefined): string => {
    if (!dateInput) return '-';
    try {
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) {
            if (typeof dateInput === 'string') {
                 const parts = dateInput.split('-');
                 if (parts.length === 3) {
                     const year = parseInt(parts[0]);
                     const month = parseInt(parts[1]);
                     const day = parseInt(parts[2]);
                     if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                          const d = new Date(year, month - 1, day);
                          if (!isNaN(d.getTime())) {
                              return d.toLocaleDateString('en-GB'); // DD/MM/YYYY
                          }
                     }
                 }
            }
            return String(dateInput); 
        }
        return date.toLocaleDateString('en-GB'); // DD/MM/YYYY
    } catch (e) {
        console.warn("Could not format date:", dateInput, e);
        return String(dateInput);
    }
};


export default function ReturnVerification() {
  const [awbList, setAwbList] = useState<ReturnItem[]>([]);
  const [awbMap, setAwbMap] = useState<Map<string, number[]>>(new Map());
  const [delhiveryPrefixMap, setDelhiveryPrefixMap] = useState<Map<string, number[]>>(new Map());
  const [currentAwb, setCurrentAwb] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const verificationDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clearInputTimerRef = useRef<NodeJS.Timeout | null>(null);
  const awbInputRef = useRef<HTMLInputElement>(null);
  const [selectedAwbs, setSelectedAwbs] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    awb: '',
    courierPartner: new Set<string>(),
    productDetails: '',
    suborderId: '',
    returnReason: '',
    returnType: new Set<string>(),
    deliveredOn: new Set<string>(),
  });


  useEffect(() => {
    return () => {
      if (verificationDebounceTimerRef.current) {
        clearTimeout(verificationDebounceTimerRef.current);
      }
      if (clearInputTimerRef.current) {
        clearTimeout(clearInputTimerRef.current);
      }
    };
  }, []);

  const extractValue = (cellContent: string, keyword: string): string => {
    const lowerContent = cellContent.toLowerCase();
    const lowerKeyword = keyword.toLowerCase().trim();
    const keywordIndex = lowerContent.indexOf(lowerKeyword);
    if (keywordIndex !== -1) {
      let value = cellContent.substring(keywordIndex + keyword.length).trim();
      if (value.startsWith(':')) {
        value = value.substring(1).trim();
      }
      return value || '-';
    }
    return '';
  };


  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(null);
    setAwbList([]);
    setAwbMap(new Map());
    setDelhiveryPrefixMap(new Map());
    setCurrentAwb("");
    setVerificationStatus('idle');
setVerificationMessage(null);
    setSelectedAwbs(new Set());
    setFilters({
      awb: '',
      productDetails: '',
      suborderId: '',
      returnReason: '',
      courierPartner: new Set(),
      returnType: new Set(),
      deliveredOn: new Set(),
    });
    if (verificationDebounceTimerRef.current) clearTimeout(verificationDebounceTimerRef.current);
    if (clearInputTimerRef.current) clearTimeout(clearInputTimerRef.current);


    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array", cellDates: true, sheetStubs: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const merges: Range[] | undefined = worksheet['!merges'];

        const jsonData: (string | number | Date | null)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: null });

        const headerRowIndex = jsonData.findIndex(row => row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number')));
        if (headerRowIndex === -1) {
            throw new Error("Header row containing 'AWB Number' not found.");
        }
        const headerRow = jsonData[headerRowIndex].map(cell => typeof cell === 'string' ? cell.trim().toLowerCase() : '');

        const awbColumnIndex = 5; // Column F
        const suborderIdIndex = 1; // Column B
        const productDetailsColumnIndex = 0; // Column A
        const feeIndex = 3; // Column D
        const returnReasonIndex = 2; // Column C

        if (headerRow.length <= awbColumnIndex || !headerRow[awbColumnIndex].includes('awb number')) {
             throw new Error("Column F (index 5) does not seem to be the 'AWB Number' column based on the header.");
        }
        if (headerRow.length <= suborderIdIndex || !headerRow[suborderIdIndex].includes('suborder id')) {
             console.warn("Column B (index 1) does not seem to be the 'Suborder ID' column based on the header. Shipment grouping might be incorrect.");
        }
        if (headerRow.length <= feeIndex || !headerRow[feeIndex].includes('return shipping fee')) {
             console.warn("Column D (index 3) does not seem to be the 'Return Shipping Fee' column based on the header. RTO/Customer Return type determination might be incorrect.");
        }
         if (headerRow.length <= returnReasonIndex || !headerRow[returnReasonIndex].includes('return reason')) {
             console.warn("Column C (index 2) does not seem to be the 'Return Reason' column based on the header. Return reason might be missing.");
         }

        const deliveredIndex = headerRow.findIndex(cell => cell.includes('delivered on'));

        const extractedData: ReturnItem[] = [];
        const processedRows = new Set<number>();

        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
            if (processedRows.has(r)) continue;

            const rawJsonData: (string | number | null)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });

            const potentialAwb = (rawJsonData[r]?.[awbColumnIndex]?.toString() ?? '').trim();

            if (potentialAwb && /\d/.test(potentialAwb)) {
                const courierRowIndex = r + 1;
                let courierPartnerValue = 'Unknown';
                if (courierRowIndex < rawJsonData.length && rawJsonData[courierRowIndex]?.[awbColumnIndex]) {
                    courierPartnerValue = (rawJsonData[courierRowIndex][awbColumnIndex]?.toString() ?? 'Unknown').trim();
                    processedRows.add(courierRowIndex);
                } else {
                    console.warn(`AWB found in row (${r}), but cannot read courier partner from below or it's empty.`);
                }
                processedRows.add(r);

                let shipmentStartRow = r;
                let shipmentEndRow = r;

                if (merges && suborderIdIndex !== -1) {
                     const mergeInfo = merges.find(m => m.s.c === suborderIdIndex && m.e.c === suborderIdIndex && r >= m.s.r && r <= m.e.r);
                     if (mergeInfo) {
                         shipmentStartRow = mergeInfo.s.r;
                         shipmentEndRow = mergeInfo.e.r;
                         if (shipmentStartRow <= headerRowIndex || shipmentStartRow >= jsonData.length) {
                             console.warn(`Merge start row (${shipmentStartRow}) invalid for data row ${r}. Using row ${r} as start.`);
                             shipmentStartRow = r;
                         }
                         if (shipmentEndRow < shipmentStartRow || shipmentEndRow >= jsonData.length) {
                             console.warn(`Merge end row (${shipmentEndRow}) invalid for data row ${r}. Using row ${r} as end.`);
                              shipmentEndRow = r;
                         }
                     }
                 } else if (suborderIdIndex === -1) {
                     console.warn(`Suborder ID column not found, cannot determine shipment range from merges.`);
                 }

                let sku = '-';
                let category = '-';
                let qty = '-';
                let size = '-';
                let foundSku = false;
                let foundCategory = false;
                let foundQty = false;
                let foundSize = false;

                for (let rowIdx = shipmentStartRow; rowIdx <= shipmentEndRow; rowIdx++) {
                    if (rowIdx >= rawJsonData.length || !rawJsonData[rowIdx]?.[productDetailsColumnIndex]) continue;

                    const cellValue = (rawJsonData[rowIdx][productDetailsColumnIndex]?.toString() ?? '').trim();
                    if (!cellValue) continue;

                    let extracted;

                    if (!foundSku) {
                        extracted = extractValue(cellValue, "SKU ID:") || extractValue(cellValue, "SKU:");
                        if (extracted && extracted !== '-') {
                            sku = extracted;
                            foundSku = true;
                        }
                    }

                    if (!foundCategory) {
                        extracted = extractValue(cellValue, "Category:");
                        if (extracted && extracted !== '-') {
                            category = extracted;
                            foundCategory = true;
                        }
                    }

                    if (!foundQty) {
                        extracted = extractValue(cellValue, "Qty:") || extractValue(cellValue, "Quantity:");
                        if (extracted && extracted !== '-') {
                            qty = extracted;
                            foundQty = true;
                        }
                    }

                    if (!foundSize) {
                        extracted = extractValue(cellValue, "Size:");
                        if (extracted && extracted !== '-') {
                            size = extracted;
                            foundSize = true;
                        }
                    }

                    if (foundSku && foundCategory && foundQty && foundSize) break;
                }

                 const detailsRowParsed = jsonData[shipmentStartRow];
                 const detailsRowRaw = rawJsonData[shipmentStartRow];

                 const safeGet = (index: number, useParsedRow: boolean = false): string | Date | null => {
                     const row = useParsedRow ? detailsRowParsed : detailsRowRaw;
                     const value = row && index !== -1 && index < row.length ? row[index] : null;
                     return value;
                 };

                 const formatValue = (value: string | Date | null): string => {
                    if (value instanceof Date) {
                        return !isNaN(value.getTime()) ? value.toLocaleDateString('en-GB') : '-';
                    }
                    if (typeof value === 'string') {
                        return value.trim() || '-';
                    }
                    return (value?.toString() ?? '-').trim();
                 }

                 const shippingFeeValueRaw = safeGet(feeIndex) as string | number | null;
                 let returnTypeValue = 'Customer Return';
                 if (shippingFeeValueRaw !== null) {
                     if (Number(shippingFeeValueRaw) === 0 || String(shippingFeeValueRaw).trim() === '0') {
                         returnTypeValue = 'RTO';
                     }
                 } else {
                     console.warn(`Could not read Return Shipping Fee from Column D (index ${feeIndex}) for shipment starting at row ${shipmentStartRow}. Defaulting to 'Customer Return'.`);
                 }

                 const deliveredOnValue = safeGet(deliveredIndex, true);
                 const returnReasonValue = formatValue(safeGet(returnReasonIndex));


                 const newItem: ReturnItem = {
                     awb: potentialAwb,
                     courierPartner: courierPartnerValue,
                     suborderId: formatValue(safeGet(suborderIdIndex)),
                     sku: sku,
                     category: category,
                     qty: qty,
                     size: size,
                     returnReason: returnReasonValue,
                     returnShippingFee: shippingFeeValueRaw?.toString() ?? '-',
                     deliveredOn: deliveredOnValue ?? '-',
                     returnType: returnTypeValue,
                     received: false,
                 };
                 extractedData.push(newItem);
            } else if (potentialAwb) {
            }
            processedRows.add(r);
        }


        if (extractedData.length === 0) {
          toast({
            title: "No Data Found",
            description: `No valid AWB entries found. Check format: AWB in Col F (must contain numbers), Courier name below it. Verify file content.`,
            variant: "destructive",
          });
          setFileName(null);
        } else {
          const newAwbMap = new Map<string, number[]>();
          const newDelhiveryPrefixMap = new Map<string, number[]>();

          extractedData.forEach((item, index) => {
              const key = item.awb.toLowerCase();
              if (!newAwbMap.has(key)) {
                  newAwbMap.set(key, []);
              }
              newAwbMap.get(key)!.push(index);

              if (item.courierPartner?.toLowerCase().includes("delhivery")) {
                  const prefix = key.slice(0, -1);
                  if (prefix.length > 0 && /^\d+$/.test(prefix)) {
                      if (!newDelhiveryPrefixMap.has(prefix)) {
                          newDelhiveryPrefixMap.set(prefix, []);
                      }
                      newDelhiveryPrefixMap.get(prefix)!.push(index);
                  }
              }
          });

          setAwbList(extractedData);
          setAwbMap(newAwbMap);
          setDelhiveryPrefixMap(newDelhiveryPrefixMap);
          toast({
            title: "File Processed Successfully",
            description: `${extractedData.length} return shipments loaded from ${file.name}.`,
          });
        }
        event.target.value = '';

      } catch (error: any) {
        console.error("Error processing file:", error);
        toast({
          title: "File Processing Error",
          description: error.message || "Could not process the Excel file. Ensure it's valid and follows the expected format.",
          variant: "destructive",
        });
        setFileName(null);
        setAwbList([]);
         event.target.value = '';
      }
    };

    reader.onerror = (error) => {
        console.error("File reading error:", error);
        toast({
            title: "File Reading Error",
            description: "An error occurred while reading the file.",
            variant: "destructive",
        });
        setFileName(null);
        event.target.value = '';
    };

    reader.readAsArrayBuffer(file);
  }, [toast]);

  const verifyAwb = useCallback((inputAwb: string): number[] => {
      const normalizedInput = inputAwb.toLowerCase().trim();
      if (!normalizedInput) return [];

      const exactMatches = awbMap.get(normalizedInput);
      if (exactMatches && exactMatches.length > 0) {
          return exactMatches;
      }

      if (normalizedInput.length > 1) {
          const inputPrefix = normalizedInput.slice(0, -1);
          if (inputPrefix.length > 0 && /^\d+$/.test(inputPrefix)) {
               const prefixMatches = delhiveryPrefixMap.get(inputPrefix);
               if (prefixMatches && prefixMatches.length > 0) {
                   return prefixMatches;
               }
          }
      }

      return [];
  }, [awbMap, delhiveryPrefixMap]);


  const handleAwbInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newAwb = event.target.value;
    setCurrentAwb(newAwb);
    setVerificationStatus('idle');
    setVerificationMessage(null);

    if (clearInputTimerRef.current) {
      clearTimeout(clearInputTimerRef.current);
      clearInputTimerRef.current = null;
    }

    if (verificationDebounceTimerRef.current) {
      clearTimeout(verificationDebounceTimerRef.current);
    }

    const trimmedAwb = newAwb.trim();

    if (trimmedAwb.length >= 5 && awbList.length > 0) {
      setIsVerifying(true);

      verificationDebounceTimerRef.current = setTimeout(() => {
        const foundIndices = verifyAwb(trimmedAwb);
        let currentStatus: VerificationStatus = 'idle';
        let currentMessage: string | null = null;

        if (foundIndices.length > 0) {
            let allPreviouslyReceived = true;
            const updatedList = [...awbList];
            const successfullyVerifiedItems: ReturnItem[] = [];

            foundIndices.forEach(index => {
                const matchedItem = updatedList[index];
                if (!matchedItem.received) {
                    allPreviouslyReceived = false;
                    updatedList[index] = { ...matchedItem, received: true };
                    successfullyVerifiedItems.push(matchedItem);
                }
            });

            if (!allPreviouslyReceived) {
                setAwbList(updatedList);
                currentStatus = 'success';
                const firstVerified = successfullyVerifiedItems[0] || awbList[foundIndices[0]];
                const actualAwb = firstVerified.awb;
                const displayAwb = actualAwb.toLowerCase() === trimmedAwb.toLowerCase() ? trimmedAwb : `${trimmedAwb} (matched ${actualAwb})`;
                const verifiedCount = successfullyVerifiedItems.length;
                const totalMatches = foundIndices.length;
                const suborderIds = foundIndices.map(idx => awbList[idx].suborderId || '-').join(', ');

                const highlightQty = shouldHighlightQty(firstVerified.qty);
                const highlightReason = shouldHighlightReason(firstVerified.returnReason);
                const needsHighlight = highlightQty || highlightReason;

                toast({
                    title: `AWB ${displayAwb} Verified (${verifiedCount} of ${totalMatches} matching order${totalMatches > 1 ? 's' : ''})`,
                    description: (
                        <div>
                            <p><strong>Courier:</strong> {firstVerified.courierPartner || 'Unknown'}</p>
                            <p><strong>Return Type:</strong> {firstVerified.returnType || '-'}</p>
                            <p><strong>Suborder IDs:</strong> {suborderIds}</p>
                             <p className={cn(highlightReason && "font-bold text-destructive")}>
                                 <strong>Reason:</strong> {firstVerified.returnReason || '-'}
                             </p>
                            <p>
                                <strong>Product:</strong> SKU: {firstVerified.sku || '-'} | Cat: {firstVerified.category || '-'} | {' '}
                                <span className={cn(highlightQty && "font-bold text-destructive")}>
                                    Qty: {firstVerified.qty || '-'}
                                </span> | Size: {firstVerified.size || '-'}
                             </p>
                        </div>
                    ),
                    duration: 15000,
                    className: cn(needsHighlight && "border-destructive border-2"),
                });
                
                if (needsHighlight) {
                    playSound('/sounds/verify-alert.mp3');
                } else {
                    playSound('/sounds/verify-success.mp3');
                }

                setCurrentAwb("");
                awbInputRef.current?.focus();
                currentMessage = null;

            } else {
                 currentStatus = 'info';
                 const firstItem = awbList[foundIndices[0]];
                 const actualAwb = firstItem.awb;
                 const displayAwb = actualAwb.toLowerCase() === trimmedAwb.toLowerCase() ? trimmedAwb : `${trimmedAwb} (matched ${actualAwb})`;
                 currentMessage = `AWB ${displayAwb} (all ${foundIndices.length} matching order${foundIndices.length > 1 ? 's' : ''}) already marked as received.`;
                 playSound('/sounds/verify-oops.mp3');
            }
        } else {
          currentStatus = 'error';
          currentMessage = `AWB ${trimmedAwb} not found in the uploaded list or could not be matched.`;
          playSound('/sounds/verify-oops.mp3');
        }

        setVerificationStatus(currentStatus);
        setVerificationMessage(currentMessage);

        if (currentStatus === 'error' || currentStatus === 'info') {
             if (clearInputTimerRef.current) clearTimeout(clearInputTimerRef.current);
             clearInputTimerRef.current = setTimeout(() => {
                 setCurrentAwb(prevAwb => {
                     if (prevAwb.trim() === trimmedAwb) {
                         setVerificationMessage(null);
                         setVerificationStatus('idle');
                         return "";
                     }
                     return prevAwb;
                 });
                 clearInputTimerRef.current = null;
             }, 5000);
        }

        setIsVerifying(false);
      }, 50);

    } else {
        setIsVerifying(false);
         if (verificationDebounceTimerRef.current) {
             clearTimeout(verificationDebounceTimerRef.current);
         }
    }
  };

  const missingAwbs = useMemo(() => {
    return awbList.filter((item) => {
        if (item.received) return false;

        const f = filters;
        const check = (value: string | undefined, filter: string) =>
            !filter || (value && value.toLowerCase().includes(filter.toLowerCase()));

        const checkSet = (value: string | undefined, filterSet: Set<string>) =>
            filterSet.size === 0 || (value && filterSet.has(value));

        const productDetailsString = `${item.sku} ${item.category} ${item.qty} ${item.size}`;

        return (
            check(item.awb, f.awb) &&
            checkSet(item.courierPartner, f.courierPartner) &&
            check(productDetailsString, f.productDetails) &&
            check(item.suborderId, f.suborderId) &&
            check(item.returnReason, f.returnReason) &&
            checkSet(item.returnType, f.returnType) &&
            checkSet(formatDate(item.deliveredOn), f.deliveredOn)
        );
    });
  }, [awbList, filters]);

  const receivedCount = useMemo(() => awbList.filter((item) => item.received).length, [awbList]);

  const getAlertVariant = (status: VerificationStatus): 'default' | 'destructive' => {
      return status === 'error' ? 'destructive' : 'default';
  }

  const getAlertIcon = (status: VerificationStatus) => {
       switch (status) {
          case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
          case 'info': return <Info className="h-4 w-4 text-blue-500" />;
          default: return null;
       }
  }

  const handleDownloadReport = useCallback(() => {
    if (awbList.length === 0) {
      toast({
        title: "No Data",
        description: "Upload a file first to generate a report.",
        variant: "destructive",
      });
      return;
    }

    try {
      const reportData = awbList.map(item => ({
            'AWB Number': item.awb,
            'Courier Partner': item.courierPartner || 'Unknown',
            'SKU': item.sku || '-',
            'Category': item.category || '-',
            'Qty': item.qty || '-',
            'Size': item.size || '-',
            'Return Type': item.returnType || '-',
            'Suborder ID': item.suborderId || '-',
             'Return Reason': item.returnReason || '-',
             'Return Shipping Fee': item.returnShippingFee || '-',
            'Delivered On': formatDate(item.deliveredOn),
            'Status': item.received ? 'Done' : 'Pending',
      }));

      const ws = XLSX.utils.json_to_sheet(reportData);

      const range = XLSX.utils.decode_range(ws['!ref']!);
      const statusColumnIndex = Object.keys(reportData[0]).findIndex(key => key === 'Status');

      if (statusColumnIndex !== -1) {
          for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            const statusCellAddress = XLSX.utils.encode_cell({ c: statusColumnIndex, r: R });
            const statusCell = ws[statusCellAddress];

            if (statusCell && statusCell.v === 'Pending') {
              for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
                if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' };
                ws[cellAddress].s = {
                  fill: { patternType: "solid", fgColor: { rgb: "FFFF0000" } }
                };
              }
            }
          }
      }

      const colWidths = Object.keys(reportData[0]).map(key => ({
        wch: Math.max(
          key.length,
          ...reportData.map(row => (row[key as keyof typeof row] ? String(row[key as keyof typeof row]).length : 0))
        ) + 2
      }));
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Return Status Report");

      const dateStr = new Date().toISOString().split('T')[0];
      const outputFileName = `Return_Status_Report_${dateStr}.xlsx`;
      XLSX.writeFile(wb, outputFileName);

      toast({
        title: "Report Downloaded",
        description: `Successfully generated ${outputFileName}.`,
      });

    } catch (error: any) {
      console.error("Error generating report:", error);
      toast({
        title: "Report Generation Error",
        description: error.message || "Could not generate the Excel report.",
        variant: "destructive",
      });
    }
  }, [awbList, toast]);


  const handleMarkSelectedAsReceived = useCallback(() => {
    if (selectedAwbs.size === 0) return;

    const updatedList = awbList.map(item => {
      if (selectedAwbs.has(item.awb)) {
        return { ...item, received: true };
      }
      return item;
    });

    setAwbList(updatedList);
    toast({
      title: "Items Marked as Received",
      description: `${selectedAwbs.size} shipment(s) have been updated.`,
    });
    setSelectedAwbs(new Set());
  }, [awbList, selectedAwbs, toast]);

  const handleTextFilterChange = (column: 'awb' | 'productDetails' | 'suborderId' | 'returnReason', value: string) => {
    setFilters(prev => ({ ...prev, [column]: value }));
  };

  const handleCheckboxFilterChange = (
    column: 'courierPartner' | 'returnType' | 'deliveredOn',
    value: string,
    checked: boolean
  ) => {
      setFilters(prev => {
          const newSet = new Set(prev[column]);
          if (checked) {
              newSet.add(value);
          } else {
              newSet.delete(value);
          }
          return { ...prev, [column]: newSet };
      });
  };

  const clearFilters = () => {
    setFilters({
      awb: '',
      productDetails: '',
      suborderId: '',
      returnReason: '',
      courierPartner: new Set(),
      returnType: new Set(),
      deliveredOn: new Set(),
    });
  };

  const areFiltersApplied = useMemo(() => {
    return (
      filters.awb !== '' ||
      filters.productDetails !== '' ||
      filters.suborderId !== '' ||
      filters.returnReason !== '' ||
      filters.courierPartner.size > 0 ||
      filters.returnType.size > 0 ||
      filters.deliveredOn.size > 0
    );
  }, [filters]);


    const missingAwbsTable = useMemo(() => {
        const textFiltersApplied = filters.awb || filters.productDetails || filters.suborderId || filters.returnReason;
        const checkboxFiltersApplied = filters.courierPartner.size > 0 || filters.returnType.size > 0 || filters.deliveredOn.size > 0;

        if (awbList.length > 0 && missingAwbs.length === 0 && (textFiltersApplied || checkboxFiltersApplied)) {
             return (
                 <div className="p-6 text-center text-muted-foreground">
                     No missing items match the current filters.
                 </div>
             );
        }

        if (missingAwbs.length === 0 && awbList.length > 0) {
            return (
              <div className="p-6">
                  <Alert variant="default" className="border-accent bg-accent/10 dark:bg-accent/20">
                     <div className="flex items-start">
                        <div className="flex-shrink-0 pt-0.5">
                            <CheckCircle className="h-4 w-4 text-accent" />
                        </div>
                        <div className="ml-3 flex-1">
                           <AlertTitle className="text-accent">All Clear!</AlertTitle>
                          <AlertDescription className="font-medium text-accent/90">
                            All AWB numbers from the uploaded list have been successfully verified.
                          </AlertDescription>
                        </div>
                     </div>
                  </Alert>
              </div>
            );
        }

        if (awbList.length === 0) {
             return (
              <div className="p-6">
                  <Alert variant="default" className="border-blue-500/50 bg-blue-500/10 dark:bg-blue-500/20">
                     <AlertTitle className="text-blue-700 dark:text-blue-300">Getting Started</AlertTitle>
                     <AlertDescription className="text-blue-700/90 dark:text-blue-300/90">
                       Upload an Excel report to begin verifying your returns.
                     </AlertDescription>
                  </Alert>
              </div>
            );
        }

        const handleSelectAll = (checked: boolean | "indeterminate") => {
            if (checked === true) {
                const allVisibleMissingAwbs = new Set(missingAwbs.map(item => item.awb));
                setSelectedAwbs(allVisibleMissingAwbs);
            } else {
                setSelectedAwbs(new Set());
            }
        };

        const handleSelect = (awb: string, isSelected: boolean) => {
            const newSelection = new Set(selectedAwbs);
            if (isSelected) {
                newSelection.add(awb);
            } else {
                newSelection.delete(awb);
            }
            setSelectedAwbs(newSelection);
        };

        const FilterPopover = ({ column, title }: { column: 'courierPartner' | 'returnType' | 'deliveredOn', title: string }) => {
            const options = useMemo(() => {
                const uniqueValues = new Set(awbList.map(item => {
                    if (column === 'deliveredOn') {
                        return formatDate(item.deliveredOn);
                    }
                    return item[column] || 'Unknown';
                }));
                return Array.from(uniqueValues).sort();
            }, [column, awbList]);

            const activeFilters = filters[column];

            return (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className={cn("h-8 ml-2 p-1", activeFilters.size > 0 && "text-accent")}>
                           <Filter className="h-4 w-4" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                        <div className="p-2 font-bold border-b">{title}</div>
                        <ScrollArea className="max-h-[200px]">
                          <div className="p-2 space-y-2">
                            {options.map(option => (
                                <div key={option} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`${column}-${option}`}
                                        checked={activeFilters.has(option)}
                                        onCheckedChange={(checked) => handleCheckboxFilterChange(column, option, !!checked)}
                                    />
                                    <label htmlFor={`${column}-${option}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {option}
                                    </label>
                                </div>
                            ))}
                          </div>
                        </ScrollArea>
                    </PopoverContent>
                </Popover>
            );
        };

        const visibleSelectedCount = missingAwbs.filter(item => selectedAwbs.has(item.awb)).length;
        const isAllSelected = visibleSelectedCount > 0 && visibleSelectedCount === missingAwbs.length;
        const isPartiallySelected = visibleSelectedCount > 0 && visibleSelectedCount < missingAwbs.length;

        return (
            <ScrollArea className="h-[450px] border-t" orientation="both">
                <Table>
                    <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                      <TableRow>
                        <TableHead className="w-[50px]">
                            <Checkbox
                                checked={isAllSelected ? true : isPartiallySelected ? "indeterminate" : false}
                                onCheckedChange={handleSelectAll}
                                aria-label="Select all visible"
                            />
                        </TableHead>
                        <TableHead className="min-w-[150px] font-semibold">AWB Number</TableHead>
                        <TableHead className="min-w-[150px] font-semibold whitespace-nowrap"><div className="flex items-center"><Truck size={16} className="mr-1"/> Courier <FilterPopover column="courierPartner" title="Filter by Courier" /></div></TableHead>
                        <TableHead className="font-semibold min-w-[200px] whitespace-nowrap"><div className="flex items-center"><Package size={16} className="mr-1"/> Product Details</div></TableHead>
                        <TableHead className="min-w-[120px] font-semibold whitespace-nowrap">Suborder ID</TableHead>
                        <TableHead className="min-w-[130px] font-semibold whitespace-nowrap">Return Reason</TableHead>
                        <TableHead className="min-w-[130px] font-semibold whitespace-nowrap"><div className="flex items-center">Return Type <FilterPopover column="returnType" title="Filter by Return Type" /></div></TableHead>
                        <TableHead className="min-w-[100px] font-semibold whitespace-nowrap"><div className="flex items-center">Delivered On <FilterPopover column="deliveredOn" title="Filter by Delivered Date" /></div></TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>{
                    missingAwbs.map((item, index) => {
                        const highlightQty = shouldHighlightQty(item.qty);
                        const highlightReason = shouldHighlightReason(item.returnReason);
                        const isSelected = selectedAwbs.has(item.awb);
                        return (
                            <TableRow
                                key={`${item.awb}-${item.suborderId}-${index}`}
                                data-state={isSelected && "selected"}
                                className="hover:bg-muted/30"
                            >
                            <TableCell>
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => handleSelect(item.awb, !!checked)}
                                    aria-label={`Select row for AWB ${item.awb}`}
                                />
                            </TableCell>
                            <TableCell className="font-medium whitespace-normal break-words">{item.awb}</TableCell>
                            <TableCell className="whitespace-normal break-words">{item.courierPartner || 'Unknown'}</TableCell>
                            <TableCell className="text-xs whitespace-normal break-words">
                                <div>SKU: {item.sku || '-'}</div>
                                <div>Cat: {item.category || '-'}</div>
                                <div>
                                   <span className={cn(highlightQty && "font-bold text-destructive")}>
                                       Qty: {item.qty || '-'}
                                   </span> | Size: {item.size || '-'}
                                </div>
                            </TableCell>
                            <TableCell className="whitespace-normal break-words">{item.suborderId || '-'}</TableCell>
                            <TableCell className={cn("whitespace-normal break-words", highlightReason && "font-bold text-destructive")}>
                                 {item.returnReason || '-'}
                             </TableCell>
                            <TableCell className="whitespace-normal break-words">{item.returnType || '-'}</TableCell>
                            <TableCell className="whitespace-normal break-words">{formatDate(item.deliveredOn)}</TableCell>
                            </TableRow>
                         );
                       })}
                    </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        );
    }, [missingAwbs, selectedAwbs, filters, awbList]);


  return (
    <div className="container mx-auto p-4 md:p-6 flex flex-col min-h-full">
      <div className="flex-grow space-y-6">
        <header className="text-center mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-primary">ReturnVerify</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">Streamline your ecommerce return verification process.</p>
        </header>

      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary p-4 md:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 md:h-6 md:w-6" /> Upload Return Data
            </CardTitle>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                      <CardDescription className="text-secondary-foreground pt-1 cursor-help text-sm">
                         Excel Format Requirements <Info size={14} className="inline ml-1 align-text-top" />
                      </CardDescription>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-sm" side="bottom" align="start">
                        <ul className="list-disc space-y-1 pl-4">
                           <li>File must be <strong>.xlsx</strong></li>
                           <li><strong>Col F:</strong> AWB Number (must contain digits).</li>
                           <li><strong>Row directly below AWB (in Col F):</strong> Courier Partner Name.</li>
                           <li><strong>Col B:</strong> Suborder ID (used for grouping items in one shipment). Merged cells in this column define the shipment range.</li>
                           <li><strong>Col A:</strong> Product Details within the shipment range (each on a separate row):
                                <ul className="list-['-_'] pl-4">
                                    <li><code>SKU ID: [value]</code> or <code>SKU: [value]</code></li>
                                    <li><code>Category: [value]</code></li>
                                    <li><code>Qty: [value]</code> or <code>Quantity: [value]</code></li>
                                    <li><code>Size: [value]</code></li>
                                </ul>
                           </li>
                            <li><strong>Col C:</strong> Return Reason (within the shipment range).</li>
                           <li><strong>Col D:</strong> Return Shipping Fee (0 or '0' indicates RTO, others are Customer Return).</li>
                           <li>Other columns like Delivered On are optional but recommended. Dates should be parseable (e.g., YYYY-MM-DD).</li>
                        </ul>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
          </div>
          <div className="self-start md:self-center">
              <Link href="/resume" passHref>
                <Button variant="outline">
                  <History className="mr-2 h-4 w-4" />
                  Resume Check
                </Button>
              </Link>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6 space-y-4">
          <label htmlFor="excel-upload" className="block text-sm font-medium text-foreground mb-2">Select Excel File:</label>
          <Input
            id="excel-upload"
            type="file"
            accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileUpload}
            className="block w-full text-sm text-foreground h-11 py-2 px-3
                       file:mr-4 file:py-2 file:px-4
                       file:rounded-lg file:border-0
                       file:text-sm file:font-semibold
                       file:bg-primary file:text-primary-foreground
                       hover:file:bg-primary/90
                       cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {fileName && (
            <p className="text-sm text-muted-foreground flex items-center gap-2 mt-3">
              <FileText className="h-4 w-4" />
              Loaded: <span className="font-medium">{fileName}</span> ({awbList.length} return shipments found)
            </p>
          )}
        </CardContent>
      </Card>
      
      {awbList.length > 0 && (
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-2xl font-semibold flex items-center gap-3">
               <ScanLine className="h-5 w-5 md:h-6 md:w-6" /> Verify Received AWBs
            </CardTitle>
            <CardDescription className="pt-1 text-sm">
              Enter AWB numbers. Delhivery matches ignore the last digit. Verification triggers automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6 space-y-4">
             <label htmlFor="awb-input" className="block text-sm font-medium text-foreground mb-2">Enter AWB Number:</label>
            <Input
              id="awb-input"
              ref={awbInputRef}
              type="text"
              placeholder="Scan or type AWB Number here..."
              value={currentAwb}
              onChange={handleAwbInputChange}
              disabled={awbList.length === 0}
              className="text-base p-3 h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="AWB Number Input"
              autoComplete="off"
            />
            {isVerifying && <p className="text-sm text-muted-foreground mt-2 animate-pulse">Verifying...</p>}

             {verificationStatus !== 'idle' && verificationStatus !== 'success' && verificationMessage && (
                 <Alert variant={getAlertVariant(verificationStatus)} className="mt-4">
                   <div className="flex items-start">
                     <div className="flex-shrink-0 pt-0.5">
                       {getAlertIcon(verificationStatus)}
                     </div>
                     <div className="ml-3 flex-1">
                       <AlertTitle className="font-semibold">
                          {verificationStatus === 'info' ? 'Already Verified' :
                           verificationStatus === 'error' ? 'Not Found' : ''}
                       </AlertTitle>
                       <AlertDescription>
                         {verificationMessage}
                       </AlertDescription>
                     </div>
                   </div>
                 </Alert>
             )}
          </CardContent>
           <CardFooter className="bg-muted/50 p-4 border-t flex flex-col sm:flex-row justify-between items-center gap-2">
             <p className="text-sm text-muted-foreground text-center sm:text-left">
                 {receivedCount} of {awbList.length} shipment(s) marked as received.
             </p>
              <Button
                  onClick={handleDownloadReport}
                  variant="outline"
                  size="sm"
                  disabled={awbList.length === 0}
               >
                  <Download className="mr-2 h-4 w-4" />
                  Download Report
              </Button>
           </CardFooter>
        </Card>
      )}

      {awbList.length > 0 && (
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="bg-destructive/10 dark:bg-destructive/20 p-4 md:p-6 flex flex-col sm:flex-row justify-between items-start gap-2">
             <div>
                <CardTitle className="text-lg md:text-2xl font-semibold flex items-center gap-3 text-destructive">
                  <AlertTriangle className="h-5 w-5 md:h-6 md:w-6" /> Missing AWB Report ({missingAwbs.length})
                </CardTitle>
                <CardDescription className="pt-1 text-destructive/90 text-sm">
                  Shipments from the sheet whose AWB has not been scanned/verified as received.
                </CardDescription>
             </div>
             {areFiltersApplied && (
                <Button
                  onClick={clearFilters}
                  variant="outline"
                  size="sm"
                  className="self-start sm:self-center"
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear Filters
                </Button>
             )}
          </CardHeader>
          <CardContent className="p-0">
            {missingAwbsTable}
          </CardContent>
           {missingAwbs.length > 0 && (
             <CardFooter className="bg-muted/50 p-4 border-t flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-center sm:text-left">
                   {selectedAwbs.size > 0 && (
                     <p className="text-sm text-destructive font-medium">
                       {selectedAwbs.size} item(s) selected.
                     </p>
                   )}
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <p className="text-sm text-muted-foreground">
                      {missingAwbs.length} missing shipment(s) listed.
                  </p>
                  {selectedAwbs.size > 0 && (
                    <Button
                      onClick={handleMarkSelectedAsReceived}
                      size="sm"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Mark Selected as Received
                    </Button>
                  )}
                </div>
             </CardFooter>
           )}
        </Card>
      )}
      </div>
    </div>
  );
}

    