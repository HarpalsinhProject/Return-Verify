// src/components/ReturnVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo, useRef, useEffect } from "react"; // Added useRef and useEffect
import * as XLSX from "xlsx";
import type { Range } from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download, Package, Info, FileSpreadsheet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


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

export default function ReturnVerification() {
  const [awbList, setAwbList] = useState<ReturnItem[]>([]);
  const [currentAwb, setCurrentAwb] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const verificationDebounceTimerRef = useRef<NodeJS.Timeout | null>(null); // For debouncing verification
  const clearInputTimerRef = useRef<NodeJS.Timeout | null>(null); // For clearing input after error


  // Cleanup timers on component unmount
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


  // Helper function to extract value after a keyword (case-insensitive, trims whitespace)
  const extractValue = (cellContent: string, keyword: string): string => {
    const lowerContent = cellContent.toLowerCase();
    // Trim whitespace around the keyword itself for matching
    const lowerKeyword = keyword.toLowerCase().trim();
    const keywordIndex = lowerContent.indexOf(lowerKeyword);
    if (keywordIndex !== -1) {
      let value = cellContent.substring(keywordIndex + keyword.length).trim();
      // Remove leading colon or other separators if present
      if (value.startsWith(':')) {
        value = value.substring(1).trim();
      }
      // Return '-' only if the extracted value is truly empty after trimming
      return value || '-';
    }
    return ''; // Return empty string if keyword not found
  };


  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state for new upload
    setFileName(null);
    setAwbList([]);
    setCurrentAwb("");
    setVerificationStatus('idle');
    setVerificationMessage(null);
    // Clear any pending timers
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

        // Use { raw: true, dateNF: 'yyyy-mm-dd', defval: null } for better empty cell handling
        const jsonData: (string | number | Date | null)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, dateNF: 'yyyy-mm-dd', defval: null });

        const headerRowIndex = jsonData.findIndex(row => row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number')));
        if (headerRowIndex === -1) {
            throw new Error("Header row containing 'AWB Number' not found.");
        }
        // Map header row, converting null/undefined to empty string, and trimming strings
        const headerRow = jsonData[headerRowIndex].map(cell => typeof cell === 'string' ? cell.trim().toLowerCase() : '');

        const awbColumnIndex = 5; // Column F
        const suborderIdIndex = 1; // Column B
        const productDetailsColumnIndex = 0; // Column A for SKU etc.
        const feeIndex = 3; // Column D - Return Shipping Fee

        if (headerRow.length <= awbColumnIndex || !headerRow[awbColumnIndex].includes('awb number')) {
             throw new Error("Column F (index 5) does not seem to be the 'AWB Number' column based on the header.");
        }
        if (headerRow.length <= suborderIdIndex || !headerRow[suborderIdIndex].includes('suborder id')) {
             console.warn("Column B (index 1) does not seem to be the 'Suborder ID' column based on the header. Shipment grouping might be incorrect.");
        }
        if (headerRow.length <= feeIndex || !headerRow[feeIndex].includes('return shipping fee')) {
             console.warn("Column D (index 3) does not seem to be the 'Return Shipping Fee' column based on the header. RTO/Customer Return type determination might be incorrect.");
        }

        // Dynamically find other columns
        const returnReasonIndex = headerRow.findIndex(cell => cell.includes('return reason'));
        const deliveredIndex = headerRow.findIndex(cell => cell.includes('delivered on'));

        const extractedData: ReturnItem[] = [];
        const processedRows = new Set<number>();

        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
            if (processedRows.has(r)) continue;

            // Use nullish coalescing and toString() for safety, then trim
            const potentialAwb = (jsonData[r]?.[awbColumnIndex]?.toString() ?? '').trim();

            // Check if it's a valid-looking AWB (contains digits, not empty)
            if (potentialAwb && /\d/.test(potentialAwb)) {
                const courierRowIndex = r + 1;
                let courierPartnerValue = 'Unknown';
                if (courierRowIndex < jsonData.length && jsonData[courierRowIndex]?.[awbColumnIndex]) {
                    // Ensure courier cell is treated as string, trim
                    courierPartnerValue = (jsonData[courierRowIndex][awbColumnIndex]?.toString() ?? 'Unknown').trim();
                    processedRows.add(courierRowIndex);
                } else {
                    console.warn(`AWB found in row (${r}), but cannot read courier partner from below or it's empty.`);
                }
                processedRows.add(r); // Mark the AWB row as processed

                // Determine shipment row range based on merges in Column B
                let shipmentStartRow = r;
                let shipmentEndRow = r; // Default to current row if no merge

                if (merges && suborderIdIndex !== -1) {
                     const mergeInfo = merges.find(m => m.s.c === suborderIdIndex && m.e.c === suborderIdIndex && r >= m.s.r && r <= m.e.r);
                     if (mergeInfo) {
                         shipmentStartRow = mergeInfo.s.r;
                         shipmentEndRow = mergeInfo.e.r; // Use end row from merge
                         // Basic validation
                         if (shipmentStartRow <= headerRowIndex || shipmentStartRow >= jsonData.length) {
                             console.warn(`Merge start row (${shipmentStartRow}) invalid for data row ${r}. Using row ${r} as start.`);
                             shipmentStartRow = r;
                         }
                         if (shipmentEndRow < shipmentStartRow || shipmentEndRow >= jsonData.length) {
                             console.warn(`Merge end row (${shipmentEndRow}) invalid for data row ${r}. Using row ${r} as end.`);
                              shipmentEndRow = r;
                         }
                     } else {
                        // No merge found for this row in the Suborder ID column
                        // console.warn(`No merge found in Column B for data row ${r}. Using current row ${r} for shipment details.`);
                     }
                 } else if (suborderIdIndex === -1) {
                     console.warn(`Suborder ID column not found, cannot determine shipment range from merges.`);
                 } else {
                     // console.warn(`No merge information available in the sheet.`);
                 }


                // --- Extract SKU, Category, Qty, Size from Column A within the shipment range ---
                let sku = '-';
                let category = '-';
                let qty = '-';
                let size = '-'; // Initialize size to '-'
                let foundSku = false;
                let foundCategory = false;
                let foundQty = false;
                let foundSize = false;

                for (let rowIdx = shipmentStartRow; rowIdx <= shipmentEndRow; rowIdx++) {
                    if (rowIdx >= jsonData.length || !jsonData[rowIdx]?.[productDetailsColumnIndex]) continue;

                    const cellValue = (jsonData[rowIdx][productDetailsColumnIndex]?.toString() ?? '').trim();
                    if (!cellValue) continue; // Skip empty cells

                    let extracted;

                    // Only extract if not already found
                    if (!foundSku) {
                        extracted = extractValue(cellValue, "SKU ID:");
                        if (!extracted) extracted = extractValue(cellValue, "SKU:");
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
                        extracted = extractValue(cellValue, "Qty:");
                        if (!extracted) extracted = extractValue(cellValue, "Quantity:");
                        if (extracted && extracted !== '-') {
                            qty = extracted;
                            foundQty = true;
                        }
                    }

                    if (!foundSize) {
                        extracted = extractValue(cellValue, "Size:");
                        if (extracted && extracted !== '-') {
                            size = extracted;
                            foundSize = true; // Mark size as found
                        }
                    }

                    // Optimization: If all details are found, break early
                    if (foundSku && foundCategory && foundQty && foundSize) break;
                }
                 // --- End Extraction ---


                 // Safe get function for other details (using shipmentStartRow)
                 const detailsRow = jsonData[shipmentStartRow]; // Use start row for general details
                 const safeGet = (index: number): string => {
                     const value = detailsRow && index !== -1 && index < detailsRow.length ? detailsRow[index] : null;
                     // Format dates correctly, handle numbers, return strings, default to '-'
                     if (value instanceof Date) {
                         // Check if date is valid before formatting
                        return !isNaN(value.getTime()) ? value.toLocaleDateString() : '-';
                     }
                     return (value?.toString() ?? '-').trim();
                 };

                 // Determine Return Type based on Shipping Fee (Column D)
                 const shippingFeeValue = detailsRow && feeIndex !== -1 && feeIndex < detailsRow.length ? detailsRow[feeIndex] : null;
                 let returnTypeValue = 'Customer Return'; // Default to Customer Return
                 if (shippingFeeValue !== null) {
                     // Attempt to parse as number, handle cases where it might be a string like '0' or a number 0
                     const feeNumber = Number(shippingFeeValue);
                     if (!isNaN(feeNumber) && feeNumber === 0) {
                         returnTypeValue = 'RTO';
                     } else if (String(shippingFeeValue).trim() === '0') {
                         // Handle case where it's the string '0'
                         returnTypeValue = 'RTO';
                     }
                 } else {
                     console.warn(`Could not read Return Shipping Fee from Column D (index ${feeIndex}) for shipment starting at row ${shipmentStartRow}. Defaulting to 'Customer Return'.`);
                 }


                 const newItem: ReturnItem = {
                     awb: potentialAwb,
                     courierPartner: courierPartnerValue,
                     suborderId: safeGet(suborderIdIndex),
                     sku: sku, // Use extracted value
                     category: category, // Use extracted value
                     qty: qty, // Use extracted value
                     size: size, // Use extracted (and de-duplicated) value
                     returnReason: safeGet(returnReasonIndex),
                     returnShippingFee: shippingFeeValue?.toString() ?? '-', // Store the original fee value
                     deliveredOn: safeGet(deliveredIndex), // Keep raw, format later if needed
                     returnType: returnTypeValue, // Use determined RTO/Customer Return
                     received: false,
                 };
                 extractedData.push(newItem);
            } else if (potentialAwb) {
                // Log rows with potential non-standard AWB or other text in AWB column F for debugging
                // console.log(`Skipping row ${r}: Potential non-AWB content in Col F: "${potentialAwb}"`);
            }
            // Mark row 'r' as processed regardless of whether an AWB was found,
            // to avoid reprocessing if it's part of a courier row handled above.
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
          setAwbList(extractedData);
          toast({
            title: "File Processed Successfully",
            description: `${extractedData.length} return shipments loaded from ${file.name}.`,
          });
        }
        event.target.value = ''; // Clear file input after processing

      } catch (error: any) {
        console.error("Error processing file:", error);
        toast({
          title: "File Processing Error",
          description: error.message || "Could not process the Excel file. Ensure it's valid and follows the expected format.",
          variant: "destructive",
        });
        setFileName(null);
        setAwbList([]);
         event.target.value = ''; // Clear file input on error
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
        event.target.value = ''; // Clear file input on error
    };

    reader.readAsArrayBuffer(file);
  }, [toast]);

  const verifyAwb = useCallback((inputAwb: string): number => {
      const normalizedInput = inputAwb.toLowerCase().trim();
      if (!normalizedInput) return -1;

      let foundIndex = awbList.findIndex(
        (item) => item.awb.toLowerCase() === normalizedInput
      );

      // If not found, try Delhivery prefix match (ignore last digit)
      if (foundIndex === -1 && normalizedInput.length > 1) { // Ensure there's a last digit to ignore
          const inputPrefix = normalizedInput.slice(0, -1);
          // Check if prefix is numeric and not empty
          if (inputPrefix.length > 0 && /^\d+$/.test(inputPrefix)) {
              foundIndex = awbList.findIndex((item) => {
                  const itemLower = item.awb.toLowerCase();
                  // Ensure item AWB is long enough and courier matches Delhivery
                  if (itemLower.length > 1 && item.courierPartner?.toLowerCase().includes("delhivery")) {
                      const itemPrefix = itemLower.slice(0, -1);
                      // Ensure item prefix is also numeric and matches input prefix
                      return /^\d+$/.test(itemPrefix) && itemPrefix === inputPrefix;
                  }
                  return false;
              });
          }
      }

      return foundIndex;
  }, [awbList]);


  const handleAwbInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newAwb = event.target.value; // Don't trim immediately, allow spaces during typing
    setCurrentAwb(newAwb);
    setVerificationStatus('idle');
    setVerificationMessage(null);

    // Clear any pending input clear timer because the user is typing again
    if (clearInputTimerRef.current) {
      clearTimeout(clearInputTimerRef.current);
      clearInputTimerRef.current = null;
    }

    // Clear previous debounce timer
    if (verificationDebounceTimerRef.current) {
      clearTimeout(verificationDebounceTimerRef.current);
    }

    const trimmedAwb = newAwb.trim();

    // Auto-verify only if input is reasonably long and list exists
    if (trimmedAwb.length >= 5 && awbList.length > 0) {
      setIsVerifying(true);

      // Debounce verification
      verificationDebounceTimerRef.current = setTimeout(() => {
        const foundIndex = verifyAwb(trimmedAwb); // Use trimmed AWB for verification

        if (foundIndex !== -1) {
            const matchedItem = awbList[foundIndex];
            const actualAwb = matchedItem.awb; // AWB from the list

            if (!matchedItem.received) {
                // Mark as received
                setAwbList((prevList) => {
                  const newList = [...prevList];
                  newList[foundIndex] = { ...newList[foundIndex], received: true };
                  return newList;
                });
                setVerificationStatus('success');
                // Display scanned AWB, note if matched differently (Delhivery)
                const displayAwb = actualAwb.toLowerCase() === trimmedAwb.toLowerCase() ? trimmedAwb : `${trimmedAwb} (matched ${actualAwb})`;
                // Show detailed toast for 15 seconds
                toast({
                    title: `AWB ${displayAwb} Verified`,
                    description: (
                        <div>
                            <p><strong>Suborder ID:</strong> {matchedItem.suborderId || '-'}</p>
                            <p><strong>Courier:</strong> {matchedItem.courierPartner || 'Unknown'}</p>
                            <p><strong>Return Type:</strong> {matchedItem.returnType || '-'}</p>
                            <p><strong>Product:</strong> SKU: {matchedItem.sku || '-'} | Cat: {matchedItem.category || '-'} | Qty: {matchedItem.qty || '-'} | Size: {matchedItem.size || '-'}</p>
                        </div>
                    ),
                    duration: 15000, // 15 seconds
                });
                setCurrentAwb(""); // Clear input on success
                setVerificationMessage(null); // Clear any previous simple message
            } else {
                 // Already received
                 setVerificationStatus('info');
                 const displayAwb = actualAwb.toLowerCase() === trimmedAwb.toLowerCase() ? trimmedAwb : `${trimmedAwb} (matched ${actualAwb})`;
                 setVerificationMessage(`AWB ${displayAwb} was already marked as received.`);
                 // Optionally clear input here too, or leave it for user context
                 // setCurrentAwb("");
            }
        } else {
          // Not found
          setVerificationStatus('error');
          setVerificationMessage(`AWB ${trimmedAwb} not found in the uploaded list or could not be matched.`);
          // Schedule input field clear after 5 seconds ONLY if not found
          if (clearInputTimerRef.current) clearTimeout(clearInputTimerRef.current); // Clear existing timer first
          clearInputTimerRef.current = setTimeout(() => {
              setCurrentAwb(""); // Clear input field
              setVerificationMessage(null); // Clear the error message too
              setVerificationStatus('idle'); // Reset status
              clearInputTimerRef.current = null; // Reset timer ref
          }, 5000); // 5000ms = 5 seconds
        }
        setIsVerifying(false); // Verification finished
      }, 300); // 300ms debounce

    } else {
        // Input too short or no list, ensure verifying state is off
        setIsVerifying(false);
         // If input becomes too short, clear any pending verification timer
         if (verificationDebounceTimerRef.current) {
             clearTimeout(verificationDebounceTimerRef.current);
         }
    }
  };


  const missingAwbs = useMemo(() => awbList.filter((item) => !item.received), [awbList]);
  const receivedAwbs = useMemo(() => awbList.filter((item) => item.received), [awbList]);
  const receivedCount = receivedAwbs.length;

  const getAlertVariant = (status: VerificationStatus): 'default' | 'destructive' => {
      return status === 'error' ? 'destructive' : 'default';
  }

  const getAlertIcon = (status: VerificationStatus) => {
       switch (status) {
          // Removed success case as it's handled by toast
          case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
          case 'info': return <Info className="h-4 w-4 text-blue-500" />; // Using a standard Info icon
          default: return null;
       }
  }

  // Updated handleDownloadReport to use new fields and logic
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
            'Return Type': item.returnType || '-', // Use the determined RTO/Customer Return
            'Suborder ID': item.suborderId || '-',
             'Return Reason': item.returnReason || '-', // Added Return Reason
             'Return Shipping Fee': item.returnShippingFee || '-', // Added Fee
            'Delivered On': item.deliveredOn
                ? !isNaN(new Date(item.deliveredOn).getTime())
                    ? new Date(item.deliveredOn).toLocaleDateString()
                    : String(item.deliveredOn) // Keep as string if not a valid date
                : '-',
            'Status': item.received ? 'Done' : 'Pending',
      }));

      const ws = XLSX.utils.json_to_sheet(reportData);

      // --- Apply styling for 'Pending' rows ---
      const range = XLSX.utils.decode_range(ws['!ref']!);
      const statusColumnIndex = Object.keys(reportData[0]).findIndex(key => key === 'Status');

      if (statusColumnIndex !== -1) {
          for (let R = range.s.r + 1; R <= range.e.r; ++R) { // Start from 1 (row after header)
            const statusCellAddress = XLSX.utils.encode_cell({ c: statusColumnIndex, r: R });
            const statusCell = ws[statusCellAddress];

            if (statusCell && statusCell.v === 'Pending') {
              // Apply red background fill to all cells in that row
              for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
                if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' }; // Create cell if it doesn't exist
                ws[cellAddress].s = {
                  fill: { patternType: "solid", fgColor: { rgb: "FFFF0000" } } // Red fill (ARGB format for red)
                };
              }
            }
          }
      }
      // --- End Styling ---

      // Calculate column widths
      const colWidths = Object.keys(reportData[0]).map(key => ({
        wch: Math.max(
          key.length, // Header length
          ...reportData.map(row => (row[key as keyof typeof row] ? String(row[key as keyof typeof row]).length : 0)) // Max content length
        ) + 2 // Add padding
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


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
        {/* Header */}
        <header className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary">ReturnVerify</h1>
            <p className="text-muted-foreground mt-1">Streamline your ecommerce return verification process.</p>
        </header>

      {/* File Upload Card */}
      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary">
          <CardTitle className="text-xl md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
            <FileSpreadsheet className="h-6 w-6" /> Upload Return Data
          </CardTitle>
           <TooltipProvider>
               <Tooltip>
                   <TooltipTrigger asChild>
                      <CardDescription className="text-secondary-foreground pt-1 cursor-help underline decoration-dashed">
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
                           <li><strong>Col D:</strong> Return Shipping Fee (0 or '0' indicates RTO, others are Customer Return).</li>
                           <li>Other columns like Return Reason, Delivered On are optional but recommended.</li>
                        </ul>
                   </TooltipContent>
               </Tooltip>
           </TooltipProvider>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <label htmlFor="excel-upload" className="block text-sm font-medium text-foreground mb-2">Select Excel File:</label>
          <Input
            id="excel-upload"
            type="file"
            accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileUpload}
            className="block w-full text-sm text-foreground
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

      {/* Verification Card */}
      {awbList.length > 0 && (
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl md:text-2xl font-semibold flex items-center gap-3">
               <ScanLine className="h-6 w-6" /> Verify Received AWBs
            </CardTitle>
            <CardDescription className="pt-1">
              Enter AWB numbers. Delhivery matches ignore the last digit. Verification triggers automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
             <label htmlFor="awb-input" className="block text-sm font-medium text-foreground mb-2">Enter AWB Number:</label>
            <Input
              id="awb-input"
              type="text"
              placeholder="Scan or type AWB Number here..."
              value={currentAwb}
              onChange={handleAwbInputChange}
              disabled={awbList.length === 0}
              className="text-base p-3 h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" // Added focus styling
              aria-label="AWB Number Input"
              autoComplete="off"
            />
            {isVerifying && <p className="text-sm text-muted-foreground mt-2 animate-pulse">Verifying...</p>}

             {/* Verification Status Alert (for errors and info only) */}
             {verificationStatus !== 'idle' && verificationStatus !== 'success' && verificationMessage && (
                 <Alert variant={getAlertVariant(verificationStatus)} className="mt-4">
                   <div className="flex items-start"> {/* Use flex to align icon and text */}
                     <div className="flex-shrink-0 pt-0.5"> {/* Adjust icon position slightly */}
                       {getAlertIcon(verificationStatus)}
                     </div>
                     <div className="ml-3 flex-1"> {/* Use flex-1 to take remaining space */}
                       <AlertTitle className="font-semibold">
                          {/* verificationStatus === 'success' ? 'Verified' : */}
                           {verificationStatus === 'info' ? 'Already Verified' :
                           verificationStatus === 'error' ? 'Not Found' : ''}
                       </AlertTitle>
                       <AlertDescription> {/* Removed ml-1 */}
                         {verificationMessage}
                       </AlertDescription>
                     </div>
                   </div>
                 </Alert>
             )}
          </CardContent>
           {/* Card Footer with stats and download button */}
           <CardFooter className="bg-muted/50 p-4 border-t flex flex-wrap justify-between items-center gap-2"> {/* Added flex-wrap and gap */}
             <p className="text-sm text-muted-foreground">
                 {receivedCount} of {awbList.length} shipment(s) marked as received.
             </p>
              <Button
                  onClick={handleDownloadReport}
                  variant="outline"
                  size="sm"
                  disabled={awbList.length === 0}
                  className="ml-auto" // Keeps button to the right on larger screens
               >
                  <Download className="mr-2 h-4 w-4" />
                  Download Report
              </Button>
           </CardFooter>
        </Card>
      )}

      {/* Missing AWB Report Card */}
      {awbList.length > 0 && (
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="bg-destructive/10 dark:bg-destructive/20">
            <CardTitle className="text-xl md:text-2xl font-semibold flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-6 w-6" /> Missing AWB Report ({missingAwbs.length})
            </CardTitle>
            <CardDescription className="pt-1 text-destructive/90">
              Shipments from the sheet whose AWB has not been scanned/verified as received.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {missingAwbs.length > 0 ? (
              <ScrollArea className="h-[450px] border-t">
                {/* Wrap table in div for horizontal scrolling if needed */}
                <div className="overflow-x-auto">
                  <Table className="min-w-full"> {/* Ensure table takes at least full width */}
                    <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                      <TableRow>
                        <TableHead className="w-[150px] min-w-[150px] font-semibold">AWB Number</TableHead>
                        <TableHead className="min-w-[150px] font-semibold flex items-center gap-1"><Truck size={16} /> Courier</TableHead>
                        <TableHead className="font-semibold min-w-[200px]"><Package size={16} className="inline mr-1"/> Product Details</TableHead>
                        <TableHead className="min-w-[120px] font-semibold">Suborder ID</TableHead>
                        <TableHead className="min-w-[130px] font-semibold">Return Type</TableHead>
                        <TableHead className="min-w-[100px] font-semibold">Delivered On</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {missingAwbs.map((item, index) => (
                           <TableRow key={`${item.awb}-${index}`} className="hover:bg-muted/30">
                             <TableCell className="font-medium break-words">{item.awb}</TableCell> {/* Added break-words */}
                             <TableCell className="break-words">{item.courierPartner || 'Unknown'}</TableCell> {/* Added break-words */}
                             <TableCell className="text-xs whitespace-normal"> {/* Ensure text wraps */}
                                <div>SKU: {item.sku || '-'}</div>
                                <div>Cat: {item.category || '-'}</div>
                                <div>Qty: {item.qty || '-'} | Size: {item.size || '-'}</div>
                             </TableCell>
                             <TableCell className="break-words">{item.suborderId || '-'}</TableCell> {/* Added break-words */}
                             <TableCell className="break-words">{item.returnType || '-'}</TableCell> {/* Added break-words */}
                             <TableCell className="break-words">
                                {item.deliveredOn
                                    ? !isNaN(new Date(item.deliveredOn).getTime())
                                        ? new Date(item.deliveredOn).toLocaleDateString()
                                        : String(item.deliveredOn) // Keep as string if not valid date
                                    : '-'}
                             </TableCell>
                           </TableRow>
                         ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            ) : (
              // "All Clear" message
              <div className="p-6">
                  <Alert variant="default" className="border-accent bg-accent/10 dark:bg-accent/20">
                     <div className="flex items-start"> {/* Flex alignment for icon and text */}
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
            )}
          </CardContent>
           {/* Optional Footer for Missing AWB Card */}
           {missingAwbs.length > 0 && (
             <CardFooter className="bg-muted/50 p-4 border-t">
               <p className="text-sm text-muted-foreground">
                   {missingAwbs.length} missing shipment(s) listed above.
               </p>
             </CardFooter>
           )}
        </Card>
      )}
    </div>
  );
}
