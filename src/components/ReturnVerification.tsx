// src/components/ReturnVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo } from "react";
import * as XLSX from "xlsx";
import type { Range } from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
// Button is currently unused but kept for potential future use
// import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck } from "lucide-react";

interface ReturnItem {
  awb: string;
  productDetails?: string;
  suborderId?: string;
  returnReason?: string;
  returnShippingFee?: string | number;
  deliveredOn?: string | number | Date;
  courierPartner?: string; // Courier partner read from sheet
  received: boolean;
}

type VerificationStatus = 'success' | 'error' | 'info' | 'idle';

// Removed getCourierPartner function as it's read from the sheet now

export default function ReturnVerification() {
  const [awbList, setAwbList] = useState<ReturnItem[]>([]);
  const [currentAwb, setCurrentAwb] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state for new upload
    setFileName(null);
    setAwbList([]);
    setCurrentAwb("");
    setVerificationStatus('idle');
    setVerificationMessage(null);

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        // Read workbook with sheetStubs: true to get merge info
        const workbook = XLSX.read(data, { type: "array", cellDates: true, sheetStubs: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const merges: Range[] | undefined = worksheet['!merges']; // Array of merge ranges

        // Use defval: '' to ensure empty cells become empty strings
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });

        // Find the header row to locate columns dynamically
        const headerRowIndex = jsonData.findIndex(row => row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number')));
        if (headerRowIndex === -1) {
            throw new Error("Header row containing 'AWB Number' not found.");
        }
        const headerRow = jsonData[headerRowIndex];
        const awbColumnIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number'));
        const suborderIdIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('suborder id')); // Column B for shipment grouping

        if (awbColumnIndex === -1) {
          throw new Error("'AWB Number' column not found in the header.");
        }
        if (suborderIdIndex === -1 || suborderIdIndex !== 1) { // Assuming Suborder ID is column B (index 1)
             console.warn("Could not find 'Suborder ID' in column B. Shipment grouping might be incorrect.");
             // Proceed cautiously, or throw error if grouping is critical
             // throw new Error("'Suborder ID' column not found in column B.");
        }

        // Find indices for other optional columns
        const productDetailsIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('product details'));
        const returnReasonIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('return reason'));
        const feeIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('return shipping fee'));
        const deliveredIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('delivered on'));

        const extractedData: ReturnItem[] = [];
        const courierRows = new Set<number>(); // Track rows containing courier names

        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
            if (courierRows.has(r)) {
                continue; // Skip this row, it's a courier name row
            }

            const potentialAwb = (jsonData[r][awbColumnIndex] ?? '').toString().trim();

            // Basic check: assume if it's not empty and not already marked as courier row, it's an AWB row
            if (potentialAwb) {
                // The row below contains the courier partner name
                const courierRowIndex = r + 1;
                let courierPartnerValue = 'Unknown';
                if (courierRowIndex < jsonData.length) {
                    courierPartnerValue = (jsonData[courierRowIndex][awbColumnIndex] ?? 'Unknown').toString().trim();
                    courierRows.add(courierRowIndex); // Mark the next row as a courier row
                } else {
                    console.warn(`AWB found in the last row (${r}), cannot read courier partner from below.`);
                }

                // Find the shipment start row using merges in Column B (suborderIdIndex = 1)
                let shipmentStartRow = r; // Default to current row if no merge found
                if (merges && suborderIdIndex === 1) {
                     const mergeInfo = merges.find(m => m.s.c === suborderIdIndex && m.e.c === suborderIdIndex && r >= m.s.r && r <= m.e.r);
                     if (mergeInfo) {
                         shipmentStartRow = mergeInfo.s.r;
                         // Mark all rows in the merge (except the header) as potentially processed or courier
                         // This helps if an AWB isn't found but we hit a later row in the same merge.
                         // Simple approach: rely on courierRows Set and checking potentialAwb.
                     } else {
                         console.warn(`No merge found in Column B for row ${r}. Using current row for shipment details.`);
                     }
                 } else if (suborderIdIndex !== 1) {
                     console.warn(`Suborder ID not in Column B, cannot accurately determine shipment start row from merges.`);
                 }


                 const detailsRow = jsonData[shipmentStartRow];

                const newItem: ReturnItem = {
                    productDetails: productDetailsIndex !== -1 ? (detailsRow[productDetailsIndex] ?? '').toString() : '',
                    suborderId: suborderIdIndex !== -1 ? (detailsRow[suborderIdIndex] ?? '').toString() : '',
                    returnReason: returnReasonIndex !== -1 ? (detailsRow[returnReasonIndex] ?? '').toString() : '',
                    returnShippingFee: feeIndex !== -1 ? detailsRow[feeIndex] ?? '' : '',
                    deliveredOn: deliveredIndex !== -1 ? detailsRow[deliveredIndex] ?? '' : '',
                    awb: potentialAwb,
                    courierPartner: courierPartnerValue,
                    received: false,
                 };
                 extractedData.push(newItem);
            }
            // If potentialAwb is empty, assume it's part of a merged shipment or empty row, skip based on logic.
        }


        if (extractedData.length === 0) {
          toast({
            title: "No Data Found",
            description: `No valid AWB entries found. Check the format: AWB in column ${String.fromCharCode(65 + awbColumnIndex)}, Courier name in the cell directly below the AWB.`,
            variant: "destructive",
          });
          setFileName(null); // Clear filename if no data
        } else {
          setAwbList(extractedData);
          toast({
            title: "File Processed Successfully",
            description: `${extractedData.length} return shipments loaded from ${file.name}.`,
          });
        }
        // Reset input value to allow re-uploading the same file
        event.target.value = '';

      } catch (error: any) {
        console.error("Error processing file:", error);
        toast({
          title: "File Processing Error",
          description: error.message || "Could not process the Excel file. Ensure it's valid and follows the expected format.",
          variant: "destructive",
        });
        setFileName(null);
        setAwbList([]); // Clear list on error
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

  const handleAwbInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newAwb = event.target.value.trim();
    setCurrentAwb(newAwb);
    setVerificationStatus('idle'); // Clear status on new input
    setVerificationMessage(null);

    // Reduced verification trigger length for faster feedback, adjust if needed
    // Keep verification minimum length reasonable, e.g., 5 chars
    if (newAwb.length >= 5 && awbList.length > 0) {
      setIsVerifying(true);
      // Debounce or delay the verification slightly
      const timer = setTimeout(() => {
        const foundIndex = awbList.findIndex(
          (item) => item.awb.toLowerCase() === newAwb.toLowerCase()
        );

        if (foundIndex !== -1) {
            if (!awbList[foundIndex].received) {
                setAwbList((prevList) => {
                  const newList = [...prevList];
                  newList[foundIndex] = { ...newList[foundIndex], received: true };
                  return newList;
                });
                setVerificationStatus('success');
                setVerificationMessage(`AWB ${newAwb} marked as received.`);
                setCurrentAwb(""); // Clear input after successful verification
            } else {
                 setVerificationStatus('info');
                 setVerificationMessage(`AWB ${newAwb} was already marked as received.`);
                 // Optionally clear input even if already received
                 // setCurrentAwb("");
            }
        } else {
          setVerificationStatus('error');
          setVerificationMessage(`AWB ${newAwb} not found in the uploaded list.`);
        }
        setIsVerifying(false);
      }, 300); // 300ms delay

      // Cleanup function to clear timeout if input changes quickly
      return () => clearTimeout(timer);
    } else {
        setIsVerifying(false); // Stop verifying if input length is too short
    }
  };


  const missingAwbs = useMemo(() => awbList.filter((item) => !item.received), [awbList]);
  const receivedCount = useMemo(() => awbList.filter((item) => item.received).length, [awbList]);

  const getAlertVariant = (status: VerificationStatus): 'default' | 'destructive' => {
      switch (status) {
          case 'error': return 'destructive';
          case 'success':
          case 'info':
          default: return 'default';
      }
  }

  const getAlertIcon = (status: VerificationStatus) => {
       switch (status) {
          case 'success': return <CheckCircle className="h-4 w-4 text-accent" />;
          case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
          case 'info': return <AlertTriangle className="h-4 w-4 text-blue-500" />; // Use a distinct info color if desired
          default: return null;
       }
  }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
        <h1 className="text-3xl font-bold text-center mb-8 text-primary">ReturnVerify</h1>

      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary">
          <CardTitle className="text-xl md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
            <Upload className="h-6 w-6" /> Upload Return Data
          </CardTitle>
          <CardDescription className="text-secondary-foreground pt-1">
            Upload an Excel (.xlsx). Expects AWB in Column F, Courier Partner directly below AWB in Column F. Shipment details (Product, Suborder ID etc.) from the first row of the merged group in Columns B-E.
          </CardDescription>
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

      {awbList.length > 0 && (
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl md:text-2xl font-semibold flex items-center gap-3">
               <ScanLine className="h-6 w-6" /> Verify Received AWBs
            </CardTitle>
            <CardDescription className="pt-1">
              Enter AWB numbers to mark them as received. Verification is automatic.
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
              className="text-base p-3 h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="AWB Number Input"
              autoComplete="off" // Prevent browser suggestions
            />
            {isVerifying && <p className="text-sm text-muted-foreground mt-2 animate-pulse">Verifying...</p>}

             {verificationStatus !== 'idle' && verificationMessage && (
                 <Alert variant={getAlertVariant(verificationStatus)} className="mt-4">
                   {getAlertIcon(verificationStatus)}
                   <AlertTitle className="font-semibold"> {/* Make title bold */}
                      {verificationStatus === 'success' ? 'Verified' :
                       verificationStatus === 'info' ? 'Already Verified' :
                       verificationStatus === 'error' ? 'Not Found' : ''}
                   </AlertTitle>
                   <AlertDescription className="ml-1"> {/* Adjusted margin */}
                     {verificationMessage}
                   </AlertDescription>
                 </Alert>
             )}
          </CardContent>
           <CardFooter className="bg-muted/50 p-4 border-t"> {/* Added border-t */}
             <p className="text-sm text-muted-foreground">
                 {receivedCount} of {awbList.length} shipment(s) marked as received.
             </p>
           </CardFooter>
        </Card>
      )}

      {awbList.length > 0 && (
        <Card className="shadow-lg rounded-lg overflow-hidden">
          <CardHeader className="bg-destructive/10 dark:bg-destructive/20">
            <CardTitle className="text-xl md:text-2xl font-semibold flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-6 w-6" /> Missing AWB Report
            </CardTitle>
            <CardDescription className="pt-1 text-destructive/90">
              Shipments from the sheet whose AWB has not been scanned/verified.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0"> {/* Remove padding to allow ScrollArea to fill */}
            {missingAwbs.length > 0 ? (
              <ScrollArea className="h-[350px] border-t">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[180px] font-semibold">AWB Number</TableHead>
                      <TableHead className="font-semibold flex items-center gap-1"><Truck size={16} /> Courier</TableHead> {/* Display Courier */}
                       <TableHead className="font-semibold">Product Details</TableHead>
                       <TableHead className="font-semibold">Suborder ID</TableHead>
                       <TableHead className="font-semibold">Delivered On</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingAwbs.map((item, index) => ( // Added index for potential unique key needs
                      <TableRow key={`${item.awb}-${index}`} className="hover:bg-muted/30">
                        <TableCell className="font-medium">{item.awb}</TableCell>
                        <TableCell>{item.courierPartner || 'Unknown'}</TableCell> {/* Display Courier */}
                         <TableCell>{item.productDetails || '-'}</TableCell>
                         <TableCell>{item.suborderId || '-'}</TableCell>
                         {/* Display date nicely, handling potential invalid dates */}
                         <TableCell>
                            {item.deliveredOn
                                ? !isNaN(new Date(item.deliveredOn).getTime())
                                    ? new Date(item.deliveredOn).toLocaleDateString()
                                    : String(item.deliveredOn) // Show original value if invalid date
                                : '-'}
                         </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="p-6">
                  <Alert variant="default" className="border-accent bg-accent/10 dark:bg-accent/20">
                     <CheckCircle className="h-4 w-4 text-accent" />
                     <AlertTitle className="text-accent">All Clear!</AlertTitle>
                    <AlertDescription className="font-medium text-accent/90">
                      All AWB numbers from the uploaded list have been successfully verified.
                    </AlertDescription>
                  </Alert>
              </div>
            )}
          </CardContent>
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

    