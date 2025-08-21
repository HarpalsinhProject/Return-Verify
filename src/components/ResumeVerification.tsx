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
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download, Package, Info, FileSpreadsheet, Home, History } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
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

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const expectedHeaders = ['AWB Number', 'Status'];
        const actualHeaders = Object.keys(jsonData[0] || {});
        if (!expectedHeaders.every(h => actualHeaders.includes(h))) {
            throw new Error("Invalid report file. It must contain 'AWB Number' and 'Status' columns.");
        }

        const extractedData: ReportItem[] = jsonData.map(row => ({
          awb: String(row['AWB Number'] || ''),
          courierPartner: String(row['Courier Partner'] || '-'),
          sku: String(row['SKU'] || '-'),
          category: String(row['Category'] || '-'),
          qty: String(row['Qty'] || '-'),
          size: String(row['Size'] || '-'),
          returnType: String(row['Return Type'] || '-'),
          suborderId: String(row['Suborder ID'] || '-'),
          returnReason: String(row['Return Reason'] || '-'),
          returnShippingFee: String(row['Return Shipping Fee'] || '-'),
          deliveredOn: String(row['Delivered On'] || '-'),
          status: (row['Status'] === 'Done') ? 'Done' : 'Pending',
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

  const pendingAwbs = useMemo(() => reportList.filter(item => item.status === 'Pending'), [reportList]);
  const receivedCount = useMemo(() => reportList.filter(item => item.status === 'Done').length, [reportList]);

  const handleDownloadReport = useCallback(() => {
    if (reportList.length === 0) {
      toast({ title: "No Data", description: "Load a report first.", variant: "destructive" });
      return;
    }
    const ws = XLSX.utils.json_to_sheet(reportList);
    const range = XLSX.utils.decode_range(ws['!ref']!);
    const statusColumnIndex = reportList.length > 0 ? Object.keys(reportList[0]).indexOf('status') : -1;
    
    if (statusColumnIndex !== -1) {
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
          const statusCellAddress = XLSX.utils.encode_cell({ c: statusColumnIndex, r: R });
          const statusCell = ws[statusCellAddress];
          if (statusCell && statusCell.v === 'Pending') {
            for (let C = range.s.c; C <= range.e.c; ++C) {
              const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
              if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' };
              ws[cellAddress].s = { fill: { patternType: "solid", fgColor: { rgb: "FFFF0000" } } };
            }
          }
        }
    }
    
    const colWidths = Object.keys(reportList[0] || {}).map(key => ({
      wch: Math.max(key.length, ...reportList.map(row => String(row[key as keyof ReportItem] || '').length)) + 2
    }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Updated Return Status Report");
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Updated_Return_Report_${dateStr}.xlsx`);
    toast({ title: "Report Downloaded", description: "Updated report generated successfully." });
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

        return (
            <ScrollArea className="h-[450px] border-t whitespace-nowrap" orientation="both">
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
                        <TableHead>Courier</TableHead>
                        <TableHead>Product Details</TableHead>
                        <TableHead>Return Reason</TableHead>
                        <TableHead>Return Type</TableHead>
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
                            <TableCell className="font-medium">{item.awb}</TableCell>
                            <TableCell>{item.courierPartner}</TableCell>
                            <TableCell className="text-xs">
                                <div>SKU: {item.sku}</div>
                                <div><span className={cn(highlightQty && "font-bold text-destructive")}>Qty: {item.qty}</span> | Size: {item.size}</div>
                            </TableCell>
                            <TableCell className={cn(highlightReason && "font-bold text-destructive")}>{item.returnReason}</TableCell>
                            <TableCell>{item.returnType}</TableCell>
                            </TableRow>
                         );
                       })}
                    </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        );
    }, [pendingAwbs, selectedAwbs, reportList]);


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
        <header className="text-center mb-8 relative">
            <Link href="/" passHref>
                <Button variant="outline" size="icon" className="absolute left-0 top-1/2 -translate-y-1/2">
                    <Home className="h-4 w-4" />
                </Button>
            </Link>
            <h1 className="text-3xl font-bold text-primary">Resume Verification</h1>
            <p className="text-muted-foreground mt-1">Upload a generated report to continue where you left off.</p>
        </header>

      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary">
          <CardTitle className="text-xl md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
            <History className="h-6 w-6" /> Upload Verification Report
          </CardTitle>
          <CardDescription className="text-secondary-foreground pt-1">Select the .xlsx report file previously generated by this tool.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
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
          <CardHeader>
            <CardTitle className="text-xl md:text-2xl font-semibold flex items-center gap-3">
               <ScanLine className="h-6 w-6" /> Verify Received AWBs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
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
           <CardFooter className="bg-muted/50 p-4 border-t flex justify-between items-center">
             <p className="text-sm text-muted-foreground">
                 {receivedCount} of {reportList.length} total items marked as Done.
             </p>
              <Button onClick={handleDownloadReport} variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download Updated Report
              </Button>
           </CardFooter>
        </Card>

        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="bg-destructive/10 dark:bg-destructive/20">
             <CardTitle className="text-xl md:text-2xl font-semibold flex items-center gap-3 text-destructive">
               <AlertTriangle className="h-6 w-6" /> Pending Items ({pendingAwbs.length})
             </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {missingAwbsTable}
          </CardContent>
           {pendingAwbs.length > 0 && (
             <CardFooter className="bg-muted/50 p-4 border-t flex justify-between items-center">
                <div>
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

    