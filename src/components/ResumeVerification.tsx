
// src/components/ResumeVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download, Package, Info, FileSpreadsheet, Home, History, Filter } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ReportItem {
  awb: string;
  suborderId?: string;
  sku?: string;
  category?: string;
  qty?: string;
  size?: string;
  returnReason?: string;
  returnShippingFee?: string | number;
  deliveredOn?: string;
  courierPartner?: string;
  returnType?: string;
  status: 'Pending' | 'Done';
}

type VerificationStatus = 'success' | 'error' | 'info' | 'idle';

const playSound = (soundFileUrl: string) => {
  if (typeof window !== 'undefined') {
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

const shouldHighlightReason = (reason?: string): boolean => {
  if (!reason) return false;
  const HIGHLIGHT_REASON_KEYWORDS = ["wrong", "defective", "stain", "damage", "torn", "incomplete", "missing"];
  return HIGHLIGHT_REASON_KEYWORDS.some(keyword => reason.toLowerCase().includes(keyword));
};

const shouldHighlightQty = (qty?: string): boolean => {
    if (!qty) return false;
    const numQty = parseInt(qty, 10);
    return !isNaN(numQty) && numQty > 1;
};

export default function ResumeVerification() {
  const [reportList, setReportList] = useState<ReportItem[]>([]);
  const [awbMap, setAwbMap] = useState<Map<string, number>>(new Map());
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
      courierPartner: new Set<string>(),
      returnType: new Set<string>(),
      deliveredOn: new Set<string>(),
    });

  useEffect(() => {
    return () => {
      if (verificationDebounceTimerRef.current) clearTimeout(verificationDebounceTimerRef.current);
      if (clearInputTimerRef.current) clearTimeout(clearInputTimerRef.current);
    };
  }, []);

  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(null);
    setReportList([]);
    setAwbMap(new Map());
    setCurrentAwb("");
    setVerificationStatus('idle');
    setVerificationMessage(null);
    setSelectedAwbs(new Set());
    setFilters({
        courierPartner: new Set(),
        returnType: new Set(),
        deliveredOn: new Set(),
    });


    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const expectedHeaders = ['awb number', 'status'];
        const actualHeaders = Object.keys(jsonData[0] || {}).map(h => h.toLowerCase().trim());
        if (!expectedHeaders.every(h => actualHeaders.includes(h))) {
            throw new Error("Invalid report file. It must contain 'awb number' and 'status' columns.");
        }
        
        const awbKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'awb number') || 'AWB Number';
        const statusKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'status') || 'Status';
        const courierKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'courier partner') || 'Courier Partner';
        const skuKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'sku') || 'SKU';
        const categoryKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'category') || 'Category';
        const qtyKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'qty') || 'Qty';
        const sizeKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'size') || 'Size';
        const returnTypeKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'return type') || 'Return Type';
        const suborderIdKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'suborder id') || 'Suborder ID';
        const returnReasonKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'return reason') || 'Return Reason';
        const feeKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'return shipping fee') || 'Return Shipping Fee';
        const deliveredOnKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().trim() === 'delivered on') || 'Delivered On';


        const extractedData: ReportItem[] = jsonData.map(row => ({
          awb: String(row[awbKey] || ''),
          courierPartner: String(row[courierKey] || '-'),
          sku: String(row[skuKey] || '-'),
          category: String(row[categoryKey] || '-'),
          qty: String(row[qtyKey] || '-'),
          size: String(row[sizeKey] || '-'),
          returnType: String(row[returnTypeKey] || '-'),
          suborderId: String(row[suborderIdKey] || '-'),
          returnReason: String(row[returnReasonKey] || '-'),
          returnShippingFee: String(row[feeKey] || '-'),
          deliveredOn: String(row[deliveredOnKey] || '-'),
          status: (String(row[statusKey]).toLowerCase().trim() === 'done') ? 'Done' : 'Pending',
        }));

        if (extractedData.length === 0) {
          toast({
            title: "No Data Found",
            description: "The uploaded report seems to be empty.",
            variant: "destructive",
          });
          setFileName(null);
        } else {
          const newAwbMap = new Map<string, number>();
          extractedData.forEach((item, index) => {
            newAwbMap.set(item.awb.toLowerCase(), index);
          });
          
          setReportList(extractedData);
          setAwbMap(newAwbMap);
          toast({
            title: "Report Loaded Successfully",
            description: `${extractedData.length} items loaded from ${file.name}.`,
          });
        }
        event.target.value = '';
      } catch (error: any) {
        console.error("Error processing report file:", error);
        toast({
          title: "File Processing Error",
          description: error.message || "Could not process the report file.",
          variant: "destructive",
        });
        setFileName(null);
        setReportList([]);
        event.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }, [toast]);

  const verifyAwb = useCallback((inputAwb: string): number | null => {
      const normalizedInput = inputAwb.toLowerCase().trim();
      if (!normalizedInput) return null;

      const matchIndex = awbMap.get(normalizedInput);
      return matchIndex !== undefined ? matchIndex : null;
  }, [awbMap]);

  const handleAwbInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newAwb = event.target.value;
    setCurrentAwb(newAwb);
    setVerificationStatus('idle');
    setVerificationMessage(null);

    if (clearInputTimerRef.current) clearTimeout(clearInputTimerRef.current);
    if (verificationDebounceTimerRef.current) clearTimeout(verificationDebounceTimerRef.current);

    const trimmedAwb = newAwb.trim();

    if (trimmedAwb.length >= 5 && reportList.length > 0) {
      setIsVerifying(true);
      verificationDebounceTimerRef.current = setTimeout(() => {
        const foundIndex = verifyAwb(trimmedAwb);
        let currentStatus: VerificationStatus = 'idle';
        let currentMessage: string | null = null;

        if (foundIndex !== null) {
            const updatedList = [...reportList];
            const matchedItem = updatedList[foundIndex];
            
            if (matchedItem.status !== 'Done') {
                updatedList[foundIndex] = { ...matchedItem, status: 'Done' };
                setReportList(updatedList);
                currentStatus = 'success';
                
                const highlightQty = shouldHighlightQty(matchedItem.qty);
                const highlightReason = shouldHighlightReason(matchedItem.returnReason);
                const needsHighlight = highlightQty || highlightReason;

                toast({
                    title: `AWB ${trimmedAwb} Verified`,
                    description: (
                        <div>
                            <p><strong>Courier:</strong> {matchedItem.courierPartner}</p>
                            <p><strong>Return Type:</strong> {matchedItem.returnType}</p>
                             <p className={cn(highlightReason && "font-bold text-destructive")}>
                                 <strong>Reason:</strong> {matchedItem.returnReason}
                             </p>
                            <p>
                                <strong>Product:</strong> SKU: {matchedItem.sku} | Qty: <span className={cn(highlightQty && "font-bold text-destructive")}>{matchedItem.qty}</span>
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
            } else {
                currentStatus = 'info';
                currentMessage = `AWB ${trimmedAwb} was already marked as Done.`;
                playSound('/sounds/verify-oops.mp3');
            }
        } else {
          currentStatus = 'error';
          currentMessage = `AWB ${trimmedAwb} not found in the loaded report.`;
          playSound('/sounds/verify-oops.mp3');
        }

        setVerificationStatus(currentStatus);
        setVerificationMessage(currentMessage);

        if (currentStatus === 'error' || currentStatus === 'info') {
             if (clearInputTimerRef.current) clearTimeout(clearInputTimerRef.current);
             clearInputTimerRef.current = setTimeout(() => {
                 setCurrentAwb(prev => {
                     if (prev.trim() === trimmedAwb) {
                         setVerificationMessage(null);
                         setVerificationStatus('idle');
                         return "";
                     }
                     return prev;
                 });
                 clearInputTimerRef.current = null;
             }, 5000);
        }
        setIsVerifying(false);
      }, 50);
    } else {
        setIsVerifying(false);
        if (verificationDebounceTimerRef.current) clearTimeout(verificationDebounceTimerRef.current);
    }
  };

  const pendingAwbs = useMemo(() => {
    return reportList.filter((item) => {
        if (item.status !== 'Pending') return false;

        const f = filters;
        const checkSet = (value: string | undefined, filterSet: Set<string>) =>
            filterSet.size === 0 || (value && filterSet.has(value));

        return (
            checkSet(item.courierPartner, f.courierPartner) &&
            checkSet(item.returnType, f.returnType) &&
            checkSet(item.deliveredOn, f.deliveredOn)
        );
    });
  }, [reportList, filters]);

  const receivedCount = useMemo(() => reportList.filter(item => item.status === 'Done').length, [reportList]);

  const handleDownloadReport = useCallback(() => {
    if (reportList.length === 0) {
      toast({ title: "No Data", description: "Load a report first.", variant: "destructive" });
      return;
    }

    try {
      const reportData = reportList.map(item => ({
        'awb number': item.awb,
        'courier partner': item.courierPartner || 'Unknown',
        'sku': item.sku || '-',
        'category': item.category || '-',
        'qty': item.qty || '-',
        'size': item.size || '-',
        'return type': item.returnType || '-',
        'suborder id': item.suborderId || '-',
        'return reason': item.returnReason || '-',
        'return shipping fee': item.returnShippingFee || '-',
        'delivered on': item.deliveredOn || '-',
        'status': item.status,
      }));

      const ws = XLSX.utils.json_to_sheet(reportData);

      const range = XLSX.utils.decode_range(ws['!ref']!);
      const statusColumnIndex = Object.keys(reportData[0]).findIndex(key => key === 'status');

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
          ...reportData.map(row => String(row[key as keyof typeof row] || '').length)
        ) + 2
      }));
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Updated Return Status Report");
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `Updated_Return_Report_${dateStr}.xlsx`);
      toast({ title: "Report Downloaded", description: "Updated report generated successfully." });

    } catch (error: any) {
      console.error("Error generating report:", error);
      toast({
        title: "Report Generation Error",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive"
      });
    }
  }, [reportList, toast]);


  const handleMarkSelectedAsReceived = useCallback(() => {
    if (selectedAwbs.size === 0) return;
    const updatedList = reportList.map(item =>
      selectedAwbs.has(item.awb) ? { ...item, status: 'Done' } : item
    );
    setReportList(updatedList);
    toast({
      title: "Items Marked as Done",
      description: `${selectedAwbs.size} shipment(s) updated.`,
    });
    setSelectedAwbs(new Set());
  }, [reportList, selectedAwbs, toast]);

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

    const missingAwbsTable = useMemo(() => {
        if (reportList.length > 0 && pendingAwbs.length === 0) {
             return (
                 <div className="p-6 text-center text-muted-foreground">
                     All items from the report have been verified.
                 </div>
             );
        }

        if (pendingAwbs.length === 0) {
             return (
              <div className="p-6">
                  <Alert variant="default" className="border-accent bg-accent/10 dark:bg-accent/20">
                     <AlertTitle className="text-accent">No Pending Items</AlertTitle>
                     <AlertDescription className="font-medium text-accent/90">
                       Upload a report to begin verification.
                     </AlertDescription>
                  </Alert>
              </div>
            );
        }

        const handleSelectAll = (checked: boolean | "indeterminate") => {
            setSelectedAwbs(checked === true ? new Set(pendingAwbs.map(item => item.awb)) : new Set());
        };

        const handleSelect = (awb: string, isSelected: boolean) => {
            const newSelection = new Set(selectedAwbs);
            isSelected ? newSelection.add(awb) : newSelection.delete(awb);
            setSelectedAwbs(newSelection);
        };
        
        const isAllSelected = selectedAwbs.size > 0 && selectedAwbs.size === pendingAwbs.length;
        const isPartiallySelected = selectedAwbs.size > 0 && selectedAwbs.size < pendingAwbs.length;

        const FilterPopover = ({ column, title }: { column: 'courierPartner' | 'returnType' | 'deliveredOn', title: string }) => {
            const options = useMemo(() => {
                const uniqueValues = new Set(reportList.filter(i => i.status === 'Pending').map(item => item[column] || 'Unknown'));
                return Array.from(uniqueValues).sort();
            }, [column, reportList]);

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

        return (
            <ScrollArea className="h-[450px] border-t" orientation="both">
                <Table>
                    <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                      <TableRow>
                        <TableHead className="w-[50px]">
                            <Checkbox
                                checked={isAllSelected ? true : isPartiallySelected ? "indeterminate" : false}
                                onCheckedChange={handleSelectAll}
                            />
                        </TableHead>
                        <TableHead>AWB Number</TableHead>
                        <TableHead><div className="flex items-center">Courier<FilterPopover column="courierPartner" title="Filter by Courier"/></div></TableHead>
                        <TableHead>Product Details</TableHead>
                        <TableHead>Return Reason</TableHead>
                        <TableHead><div className="flex items-center">Return Type<FilterPopover column="returnType" title="Filter by Return Type"/></div></TableHead>
                        <TableHead><div className="flex items-center">Delivered On<FilterPopover column="deliveredOn" title="Filter by Delivered On"/></div></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                    {pendingAwbs.map((item, index) => {
                        const highlightQty = shouldHighlightQty(item.qty);
                        const highlightReason = shouldHighlightReason(item.returnReason);
                        const isSelected = selectedAwbs.has(item.awb);
                        return (
                            <TableRow key={`${item.awb}-${index}`} data-state={isSelected && "selected"}>
                            <TableCell>
                                <Checkbox checked={isSelected} onCheckedChange={(checked) => handleSelect(item.awb, !!checked)} />
                            </TableCell>
                            <TableCell className="font-medium whitespace-normal break-words">{item.awb}</TableCell>
                            <TableCell className="whitespace-normal break-words">{item.courierPartner}</TableCell>
                            <TableCell className="text-xs whitespace-normal break-words">
                                <div>SKU: {item.sku}</div>
                                <div><span className={cn(highlightQty && "font-bold text-destructive")}>Qty: {item.qty}</span> | Size: {item.size}</div>
                            </TableCell>
                            <TableCell className={cn("whitespace-normal break-words", highlightReason && "font-bold text-destructive")}>{item.returnReason}</TableCell>
                            <TableCell className="whitespace-normal break-words">{item.returnType}</TableCell>
                            <TableCell className="whitespace-normal break-words">{item.deliveredOn}</TableCell>
                            </TableRow>
                         );
                       })}
                    </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        );
    }, [pendingAwbs, selectedAwbs, reportList, filters]);


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
        <header className="text-center mb-6 relative">
            <Link href="/" passHref>
                <Button variant="outline" size="icon" className="absolute left-0 top-1/2 -translate-y-1/2">
                    <Home className="h-4 w-4" />
                </Button>
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold text-primary">Resume Verification</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">Upload a generated report to continue where you left off.</p>
        </header>

      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary p-4 md:p-6">
          <CardTitle className="text-lg md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
            <History className="h-5 w-5 md:h-6 md:w-6" /> Upload Verification Report
          </CardTitle>
          <CardDescription className="text-secondary-foreground pt-1 text-sm">Select the .xlsx report file previously generated by this tool.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <Input
            id="report-upload"
            type="file"
            accept=".xlsx"
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
              Loaded: <span className="font-medium">{fileName}</span> ({reportList.length} items)
            </p>
          )}
        </CardContent>
      </Card>
      
      {reportList.length > 0 && (
        <>
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-2xl font-semibold flex items-center gap-3">
               <ScanLine className="h-5 w-5 md:h-6 md:w-6" /> Verify Received AWBs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 space-y-4">
             <label htmlFor="awb-input" className="block text-sm font-medium text-foreground mb-2">Enter AWB Number:</label>
            <Input
              id="awb-input"
              ref={awbInputRef}
              type="text"
              placeholder="Scan or type AWB Number..."
              value={currentAwb}
              onChange={handleAwbInputChange}
              className="text-base p-3 h-11"
              autoComplete="off"
            />
            {isVerifying && <p className="text-sm text-muted-foreground mt-2 animate-pulse">Verifying...</p>}

             {verificationStatus !== 'idle' && verificationStatus !== 'success' && verificationMessage && (
                 <Alert variant={verificationStatus === 'error' ? 'destructive' : 'default'} className="mt-4">
                     <AlertTitle>{verificationStatus === 'info' ? 'Already Verified' : 'Not Found'}</AlertTitle>
                     <AlertDescription>{verificationMessage}</AlertDescription>
                 </Alert>
             )}
          </CardContent>
           <CardFooter className="bg-muted/50 p-4 border-t flex flex-col sm:flex-row justify-between items-center gap-2">
             <p className="text-sm text-muted-foreground text-center sm:text-left">
                 {receivedCount} of {reportList.length} total items marked as Done.
             </p>
              <Button onClick={handleDownloadReport} variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download Updated Report
              </Button>
           </CardFooter>
        </Card>

        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="bg-destructive/10 dark:bg-destructive/20 p-4 md:p-6">
             <CardTitle className="text-lg md:text-2xl font-semibold flex items-center gap-3 text-destructive">
               <AlertTriangle className="h-5 w-5 md:h-6 md:w-6" /> Pending Items ({pendingAwbs.length})
             </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {missingAwbsTable}
          </CardContent>
           {pendingAwbs.length > 0 && (
             <CardFooter className="bg-muted/50 p-4 border-t flex flex-col sm:flex-row justify-between items-center gap-2">
                <div className="text-center sm:text-left">
                   {selectedAwbs.size > 0 && (
                     <p className="text-sm text-destructive font-medium">{selectedAwbs.size} item(s) selected.</p>
                   )}
                </div>
                 {selectedAwbs.size > 0 && (
                    <Button onClick={handleMarkSelectedAsReceived} size="sm">
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Mark Selected as Done
                    </Button>
                  )}
             </CardFooter>
           )}
        </Card>
        </>
      )}
    </div>
  );
}
