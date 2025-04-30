// src/components/ReturnVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo } from "react";
import * as XLSX from "xlsx";
import type { Range } from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button"; // Import Button
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download } from "lucide-react"; // Import Download

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
        const workbook = XLSX.read(data, { type: "array", cellDates: true, sheetStubs: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const merges: Range[] | undefined = worksheet['!merges'];

        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });

        const headerRowIndex = jsonData.findIndex(row => row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number')));
        if (headerRowIndex === -1) {
            throw new Error("Header row containing 'AWB Number' not found.");
        }
        const headerRow = jsonData[headerRowIndex];

        // Assuming AWB is always in F (index 5) and Courier is below it
        const awbColumnIndex = 5;
        if (headerRow.length <= awbColumnIndex || !(typeof headerRow[awbColumnIndex] === 'string' && headerRow[awbColumnIndex].toLowerCase().includes('awb number'))) {
             throw new Error("Column F (index 5) does not seem to be the 'AWB Number' column based on the header.");
        }

        // Assuming Suborder ID is always in B (index 1) for merge checks
        const suborderIdIndex = 1;
        if (headerRow.length <= suborderIdIndex || !(typeof headerRow[suborderIdIndex] === 'string' && headerRow[suborderIdIndex].toLowerCase().includes('suborder id'))) {
             console.warn("Column B (index 1) does not seem to be the 'Suborder ID' column based on the header. Shipment grouping might be incorrect.");
        }


        // Find indices for other optional columns (C, D, E, H) dynamically *within the expected range*
        const productDetailsIndex = headerRow.findIndex((cell, idx) => idx >= 2 && idx <=4 && typeof cell === 'string' && cell.toLowerCase().includes('product details')); // Expect C, D, or E
        const returnReasonIndex = headerRow.findIndex((cell, idx) => idx >= 2 && idx <=4 && typeof cell === 'string' && cell.toLowerCase().includes('return reason')); // Expect C, D, or E
        const feeIndex = headerRow.findIndex((cell, idx) => idx >= 2 && idx <=4 && typeof cell === 'string' && cell.toLowerCase().includes('return shipping fee')); // Expect C, D, or E
        const deliveredIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('delivered on')); // Look anywhere for 'Delivered On'


        const extractedData: ReturnItem[] = [];
        const processedRows = new Set<number>(); // Track rows already processed (AWB or Courier)

        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
            if (processedRows.has(r)) {
                continue; // Skip rows already handled (e.g., courier rows)
            }

            const potentialAwb = (jsonData[r][awbColumnIndex] ?? '').toString().trim();

            // Basic check: assume if it's not empty and looks like an AWB (e.g., has digits), it's an AWB row
            if (potentialAwb && /\d/.test(potentialAwb)) { // Check if it contains digits
                // The row below contains the courier partner name
                const courierRowIndex = r + 1;
                let courierPartnerValue = 'Unknown';
                if (courierRowIndex < jsonData.length) {
                    // Read courier name from the same column (F) in the next row
                    courierPartnerValue = (jsonData[courierRowIndex][awbColumnIndex] ?? 'Unknown').toString().trim();
                    processedRows.add(courierRowIndex); // Mark the next row as processed (courier row)
                } else {
                    console.warn(`AWB found in the last row (${r}), cannot read courier partner from below.`);
                }

                processedRows.add(r); // Mark current row as processed (AWB row)

                // Find the shipment start row using merges in Column B (suborderIdIndex = 1)
                let shipmentStartRow = r; // Default to current row if no merge found
                if (merges && suborderIdIndex === 1) {
                     const mergeInfo = merges.find(m => m.s.c === suborderIdIndex && m.e.c === suborderIdIndex && r >= m.s.r && r <= m.e.r);
                     if (mergeInfo) {
                         shipmentStartRow = mergeInfo.s.r;
                         // Check if shipmentStartRow is valid and not header
                         if (shipmentStartRow <= headerRowIndex) {
                             console.warn(`Merge for row ${r} points to header or above (${shipmentStartRow}). Using row ${r} for shipment details.`);
                             shipmentStartRow = r;
                         }
                     } else {
                         console.warn(`No merge found in Column B for row ${r}. Using current row ${r} for shipment details.`);
                     }
                 } else if (suborderIdIndex !== 1) {
                     console.warn(`Suborder ID not in Column B, cannot accurately determine shipment start row from merges.`);
                 } else {
                     console.warn(`No merge information available in the sheet.`);
                 }

                 // Ensure shipmentStartRow is within bounds
                 if (shipmentStartRow >= jsonData.length) {
                      console.error(`Calculated shipmentStartRow (${shipmentStartRow}) is out of bounds for row ${r}. Using row ${r}.`);
                      shipmentStartRow = r;
                 }

                 const detailsRow = jsonData[shipmentStartRow];
                 // Safe access to detailsRow elements
                 const safeGet = (index: number) => (detailsRow && index !== -1 && index < detailsRow.length ? detailsRow[index] ?? '' : '').toString();


                const newItem: ReturnItem = {
                    awb: potentialAwb,
                    courierPartner: courierPartnerValue,
                    // Use safeGet for details, defaulting to empty string
                    productDetails: safeGet(productDetailsIndex),
                    suborderId: safeGet(suborderIdIndex), // Use safeGet even for suborderId
                    returnReason: safeGet(returnReasonIndex),
                    returnShippingFee: safeGet(feeIndex),
                    deliveredOn: safeGet(deliveredIndex), // Use safeGet, date parsing happens later if needed
                    received: false,
                 };
                 extractedData.push(newItem);
            }
            // If potentialAwb is empty or doesn't look like an AWB, it's skipped
            // or handled if it's part of a merge group implicitly by processedRows set
        }


        if (extractedData.length === 0) {
          toast({
            title: "No Data Found",
            description: `No valid AWB entries found. Check the format: AWB in Column F, Courier name in the cell directly below the AWB. Ensure AWBs contain numbers.`,
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
          description: error.message || "Could not process the Excel file. Ensure it's valid and follows the specified format.",
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

  const verifyAwb = useCallback((inputAwb: string): number => {
      const normalizedInput = inputAwb.toLowerCase().trim();
      if (!normalizedInput) return -1;

      // Try exact match first
      let foundIndex = awbList.findIndex(
        (item) => item.awb.toLowerCase() === normalizedInput
      );

      // If exact match not found, check for Delhivery special case
      if (foundIndex === -1) {
          const inputPrefix = normalizedInput.slice(0, -1); // Input without last digit
          if (inputPrefix.length > 0 && /^\d+$/.test(inputPrefix)) { // Ensure prefix is numeric and not empty
              foundIndex = awbList.findIndex((item) => {
                  const itemLower = item.awb.toLowerCase();
                  const itemPrefix = itemLower.slice(0, -1);
                  // Check if item's courier is Delhivery (case-insensitive) and prefixes match
                  return (
                      item.courierPartner?.toLowerCase().includes("delhivery") &&
                      itemPrefix.length > 0 &&
                      /^\d+$/.test(itemPrefix) && // Ensure item's prefix is numeric
                      itemPrefix === inputPrefix
                  );
              });
          }
      }

      return foundIndex;
  }, [awbList]);


  const handleAwbInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newAwb = event.target.value.trim();
    setCurrentAwb(newAwb);
    setVerificationStatus('idle'); // Clear status on new input
    setVerificationMessage(null);

    // Adjust minimum length if needed, e.g., if Delhivery IDs can be short
    if (newAwb.length >= 5 && awbList.length > 0) {
      setIsVerifying(true);
      // Debounce verification slightly
      const timer = setTimeout(() => {
        const foundIndex = verifyAwb(newAwb); // Use the verification function

        if (foundIndex !== -1) {
            const actualAwb = awbList[foundIndex].awb; // Get the AWB from the list
            if (!awbList[foundIndex].received) {
                setAwbList((prevList) => {
                  const newList = [...prevList];
                  newList[foundIndex] = { ...newList[foundIndex], received: true };
                  return newList;
                });
                setVerificationStatus('success');
                // Include the actual matched AWB in the message if it differs (Delhivery case)
                const messageAwb = actualAwb.toLowerCase() === newAwb.toLowerCase() ? newAwb : `${newAwb} (matched ${actualAwb})`;
                setVerificationMessage(`AWB ${messageAwb} marked as received.`);
                setCurrentAwb(""); // Clear input after successful verification
            } else {
                 setVerificationStatus('info');
                 const messageAwb = actualAwb.toLowerCase() === newAwb.toLowerCase() ? newAwb : `${newAwb} (matched ${actualAwb})`;
                 setVerificationMessage(`AWB ${messageAwb} was already marked as received.`);
                 // Optionally clear input even if already received
                 // setCurrentAwb("");
            }
        } else {
          setVerificationStatus('error');
          setVerificationMessage(`AWB ${newAwb} not found in the uploaded list or could not be matched.`);
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
  const receivedAwbs = useMemo(() => awbList.filter((item) => item.received), [awbList]); // For report
  const receivedCount = receivedAwbs.length;

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
      // Prepare data for the report
      const reportData = awbList.map(item => ({
        'AWB Number': item.awb,
        'Courier Partner': item.courierPartner || 'Unknown',
        'Product Details': item.productDetails || '-',
        'Suborder ID': item.suborderId || '-',
        'Delivered On': item.deliveredOn
            ? !isNaN(new Date(item.deliveredOn).getTime())
                ? new Date(item.deliveredOn).toLocaleDateString() // Format date
                : String(item.deliveredOn) // Keep original if not date
            : '-',
        'Status': item.received ? 'Done' : 'Pending',
        // Add other relevant fields if needed
      }));

      // Create a new workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(reportData);

      // --- Add Styling for Pending Rows ---
      const range = XLSX.utils.decode_range(ws['!ref']!);
      for (let R = range.s.r + 1; R <= range.e.r; ++R) { // Start from row 1 (data)
        const statusCellAddress = XLSX.utils.encode_cell({ c: 5, r: R }); // Column F for 'Status'
        const statusCell = ws[statusCellAddress];

        if (statusCell && statusCell.v === 'Pending') {
          // Apply red fill style to the entire row
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
            if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' }; // Ensure cell exists
            ws[cellAddress].s = { // Style object
              fill: {
                patternType: "solid",
                fgColor: { rgb: "FFFF0000" } // Red color ARGB
              }
            };
          }
        }
      }
      // --- End Styling ---


       // --- Auto-fit columns (Optional but recommended) ---
        const colWidths = reportData.reduce((widths, row) => {
            Object.entries(row).forEach(([key, value], i) => {
            const len = Math.max((value ? String(value).length : 0), key.length);
            widths[i] = Math.max(widths[i] || 10, len + 2); // Min width 10, add padding
            });
            return widths;
        }, [] as number[]);
        ws['!cols'] = colWidths.map(w => ({ wch: w }));
       // --- End Auto-fit ---


      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Return Status Report");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const outputFileName = `Return_Status_Report_${dateStr}.xlsx`;

      // Trigger download
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
        <h1 className="text-3xl font-bold text-center mb-8 text-primary">ReturnVerify</h1>

      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary">
          <CardTitle className="text-xl md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
            <Upload className="h-6 w-6" /> Upload Return Data
          </CardTitle>
          <CardDescription className="text-secondary-foreground pt-1">
            Upload Excel (.xlsx). Expects AWB in Column F, Courier below AWB in Col F. Shipment details (Product, etc.) from merged group (Col B-E).
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
              Enter AWB numbers. Delhivery matches ignore the last digit. Verification is automatic.
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
                   <AlertTitle className="font-semibold">
                      {verificationStatus === 'success' ? 'Verified' :
                       verificationStatus === 'info' ? 'Already Verified' :
                       verificationStatus === 'error' ? 'Not Found' : ''}
                   </AlertTitle>
                   <AlertDescription className="ml-1">
                     {verificationMessage}
                   </AlertDescription>
                 </Alert>
             )}
          </CardContent>
           <CardFooter className="bg-muted/50 p-4 border-t flex justify-between items-center"> {/* Use flex for layout */}
             <p className="text-sm text-muted-foreground">
                 {receivedCount} of {awbList.length} shipment(s) marked as received.
             </p>
              <Button
                  onClick={handleDownloadReport}
                  variant="outline"
                  size="sm"
                  disabled={awbList.length === 0}
                  className="ml-auto" // Push button to the right
               >
                  <Download className="mr-2 h-4 w-4" />
                  Download Report
              </Button>
           </CardFooter>
        </Card>
      )}

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
              <ScrollArea className="h-[350px] border-t">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[180px] font-semibold">AWB Number</TableHead>
                      <TableHead className="font-semibold flex items-center gap-1"><Truck size={16} /> Courier</TableHead>
                       <TableHead className="font-semibold">Product Details</TableHead>
                       <TableHead className="font-semibold">Suborder ID</TableHead>
                       <TableHead className="font-semibold">Delivered On</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingAwbs.map((item, index) => (
                      <TableRow key={`${item.awb}-${index}`} className="hover:bg-muted/30">
                        <TableCell className="font-medium">{item.awb}</TableCell>
                        <TableCell>{item.courierPartner || 'Unknown'}</TableCell>
                         <TableCell>{item.productDetails || '-'}</TableCell>
                         <TableCell>{item.suborderId || '-'}</TableCell>
                         <TableCell>
                            {item.deliveredOn
                                ? !isNaN(new Date(item.deliveredOn).getTime())
                                    ? new Date(item.deliveredOn).toLocaleDateString()
                                    : String(item.deliveredOn)
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

    