// src/components/ReturnVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo } from "react";
import * as XLSX from "xlsx";
import type { Range } from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download, Package, Info } from "lucide-react"; // Added Package, Info icons

interface ReturnItem {
  awb: string;
  productDetails?: string; // Keep as single string, format in display
  suborderId?: string;
  returnReason?: string;
  returnShippingFee?: string | number;
  deliveredOn?: string | number | Date;
  courierPartner?: string;
  returnType?: string; // Added: RTO or Return
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
        const headerRow = jsonData[headerRowIndex].map(cell => typeof cell === 'string' ? cell.toLowerCase() : ''); // Lowercase for matching

        // Assuming AWB is always in F (index 5) and Courier is below it
        const awbColumnIndex = 5;
        if (headerRow.length <= awbColumnIndex || !headerRow[awbColumnIndex].includes('awb number')) {
             throw new Error("Column F (index 5) does not seem to be the 'AWB Number' column based on the header.");
        }

        // Assuming Suborder ID is always in B (index 1) for merge checks
        const suborderIdIndex = 1;
        if (headerRow.length <= suborderIdIndex || !headerRow[suborderIdIndex].includes('suborder id')) {
             console.warn("Column B (index 1) does not seem to be the 'Suborder ID' column based on the header. Shipment grouping might be incorrect.");
        }

        // Find indices dynamically
        // Use broader search for product details first, then refine if needed
        const productDetailsIndex = headerRow.findIndex(cell => cell.includes('product details'));
        const returnReasonIndex = headerRow.findIndex(cell => cell.includes('return reason'));
        const feeIndex = headerRow.findIndex(cell => cell.includes('return shipping fee'));
        const deliveredIndex = headerRow.findIndex(cell => cell.includes('delivered on'));
        // Find Return Type column (e.g., 'Return Type' or 'Shipment Type')
        const returnTypeIndex = headerRow.findIndex(cell => cell.includes('return type') || cell.includes('shipment type'));

        const extractedData: ReturnItem[] = [];
        const processedRows = new Set<number>();

        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
            if (processedRows.has(r)) {
                continue;
            }

            const potentialAwb = (jsonData[r][awbColumnIndex] ?? '').toString().trim();

            if (potentialAwb && /\d/.test(potentialAwb)) { // Check if it contains digits
                const courierRowIndex = r + 1;
                let courierPartnerValue = 'Unknown';
                if (courierRowIndex < jsonData.length) {
                    courierPartnerValue = (jsonData[courierRowIndex][awbColumnIndex] ?? 'Unknown').toString().trim();
                    processedRows.add(courierRowIndex);
                } else {
                    console.warn(`AWB found in the last row (${r}), cannot read courier partner from below.`);
                }

                processedRows.add(r);

                let shipmentStartRow = r;
                if (merges && suborderIdIndex === 1) {
                     const mergeInfo = merges.find(m => m.s.c === suborderIdIndex && m.e.c === suborderIdIndex && r >= m.s.r && r <= m.e.r);
                     if (mergeInfo) {
                         shipmentStartRow = mergeInfo.s.r;
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

                 if (shipmentStartRow >= jsonData.length) {
                      console.error(`Calculated shipmentStartRow (${shipmentStartRow}) is out of bounds for row ${r}. Using row ${r}.`);
                      shipmentStartRow = r;
                 }

                 const detailsRow = jsonData[shipmentStartRow];
                 const safeGet = (index: number) => (detailsRow && index !== -1 && index < detailsRow.length ? detailsRow[index] ?? '' : '').toString();

                 // Extract Return Type using safeGet
                 const returnTypeValue = safeGet(returnTypeIndex);

                const newItem: ReturnItem = {
                    awb: potentialAwb,
                    courierPartner: courierPartnerValue,
                    productDetails: safeGet(productDetailsIndex),
                    suborderId: safeGet(suborderIdIndex),
                    returnReason: safeGet(returnReasonIndex),
                    returnShippingFee: safeGet(feeIndex),
                    deliveredOn: safeGet(deliveredIndex),
                    returnType: returnTypeValue || '-', // Default to '-' if empty or not found
                    received: false,
                 };
                 extractedData.push(newItem);
            }
        }


        if (extractedData.length === 0) {
          toast({
            title: "No Data Found",
            description: `No valid AWB entries found. Check the format: AWB in Column F, Courier name below it. Ensure AWBs contain numbers.`,
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
        event.target.value = '';

      } catch (error: any) {
        console.error("Error processing file:", error);
        toast({
          title: "File Processing Error",
          description: error.message || "Could not process the Excel file. Ensure it's valid and follows the specified format.",
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

  const verifyAwb = useCallback((inputAwb: string): number => {
      const normalizedInput = inputAwb.toLowerCase().trim();
      if (!normalizedInput) return -1;

      let foundIndex = awbList.findIndex(
        (item) => item.awb.toLowerCase() === normalizedInput
      );

      if (foundIndex === -1) {
          // Try Delhivery prefix match (ignore last digit)
          const inputPrefix = normalizedInput.slice(0, -1);
          if (inputPrefix.length > 0 && /^\d+$/.test(inputPrefix)) { // Check if prefix is numeric
              foundIndex = awbList.findIndex((item) => {
                  const itemLower = item.awb.toLowerCase();
                  const itemPrefix = itemLower.slice(0, -1);
                  return (
                      item.courierPartner?.toLowerCase().includes("delhivery") &&
                      itemPrefix.length > 0 &&
                      /^\d+$/.test(itemPrefix) && // Ensure item prefix is also numeric
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
    setVerificationStatus('idle');
    setVerificationMessage(null);

    // Trigger verification automatically after a short delay if input length is sufficient
    if (newAwb.length >= 5 && awbList.length > 0) { // Adjust length threshold if needed
      setIsVerifying(true);
      const timer = setTimeout(() => {
        const foundIndex = verifyAwb(newAwb);

        if (foundIndex !== -1) {
            const actualAwb = awbList[foundIndex].awb; // Get the AWB from the list
            if (!awbList[foundIndex].received) {
                setAwbList((prevList) => {
                  const newList = [...prevList];
                  newList[foundIndex] = { ...newList[foundIndex], received: true };
                  return newList;
                });
                setVerificationStatus('success');
                // Display the scanned AWB but mention which one it matched if different (Delhivery case)
                const messageAwb = actualAwb.toLowerCase() === newAwb.toLowerCase() ? newAwb : `${newAwb} (matched ${actualAwb})`;
                setVerificationMessage(`AWB ${messageAwb} marked as received.`);
                setCurrentAwb(""); // Clear input on success
            } else {
                 setVerificationStatus('info');
                 const messageAwb = actualAwb.toLowerCase() === newAwb.toLowerCase() ? newAwb : `${newAwb} (matched ${actualAwb})`;
                 setVerificationMessage(`AWB ${messageAwb} was already marked as received.`);
            }
        } else {
          setVerificationStatus('error');
          setVerificationMessage(`AWB ${newAwb} not found in the uploaded list or could not be matched.`);
        }
        setIsVerifying(false);
      }, 300); // Debounce time in ms

      // Cleanup function to clear timeout if input changes before verification
      return () => clearTimeout(timer);
    } else {
        // If input is too short or list is empty, ensure verification state is off
        setIsVerifying(false);
    }
  };


  const missingAwbs = useMemo(() => awbList.filter((item) => !item.received), [awbList]);
  const receivedAwbs = useMemo(() => awbList.filter((item) => item.received), [awbList]);
  const receivedCount = receivedAwbs.length;

  const getAlertVariant = (status: VerificationStatus): 'default' | 'destructive' => {
      switch (status) {
          case 'error': return 'destructive';
          case 'success':
          case 'info':
          default: return 'default'; // 'success' and 'info' use default styling
      }
  }

  const getAlertIcon = (status: VerificationStatus) => {
       switch (status) {
          case 'success': return <CheckCircle className="h-4 w-4 text-accent" />; // Green for success
          case 'error': return <XCircle className="h-4 w-4 text-destructive" />; // Red for error (already handled by variant)
          case 'info': return <Info className="h-4 w-4 text-blue-500" />; // Use Info icon for 'info' status
          default: return null; // No icon for 'idle'
       }
  }

   // Helper function to parse product details string
   const parseProductDetails = (details: string | undefined): { sku: string; category: string; qty: string; size: string } => {
    if (!details) return { sku: '-', category: '-', qty: '-', size: '-' };
    const parts = details.split('|').map(p => p.trim());
    // Assuming format: SKU | Category | Qty | Size
    return {
        sku: parts[0] || '-',
        category: parts[1] || '-',
        qty: parts[2] || '-',
        size: parts[3] || '-',
    };
   };


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
      const reportData = awbList.map(item => {
         const productInfo = parseProductDetails(item.productDetails);
         return {
            'AWB Number': item.awb,
            'Courier Partner': item.courierPartner || 'Unknown',
            'SKU': productInfo.sku, // Separate column for SKU
            'Category': productInfo.category, // Separate column for Category
            'Qty': productInfo.qty, // Separate column for Qty
            'Size': productInfo.size, // Separate column for Size
            'Return Type': item.returnType || '-', // Add Return Type
            'Suborder ID': item.suborderId || '-',
            //'Return Reason': item.returnReason || '-', // Optional: uncomment if needed
            //'Return Shipping Fee': item.returnShippingFee || '-', // Optional: uncomment if needed
            'Delivered On': item.deliveredOn
                ? !isNaN(new Date(item.deliveredOn).getTime())
                    ? new Date(item.deliveredOn).toLocaleDateString() // Format date if valid
                    : String(item.deliveredOn) // Otherwise, keep original string/number
                : '-',
            'Status': item.received ? 'Done' : 'Pending',
         }
      });

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(reportData);

      // --- Apply styling for 'Pending' rows ---
      const range = XLSX.utils.decode_range(ws['!ref']!);
      const statusColumnIndex = Object.keys(reportData[0]).findIndex(key => key === 'Status'); // Find status column index dynamically

      if (statusColumnIndex !== -1) {
          // Iterate through rows (skip header row)
          for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            const statusCellAddress = XLSX.utils.encode_cell({ c: statusColumnIndex, r: R });
            const statusCell = ws[statusCellAddress];

            // Check if the status is 'Pending'
            if (statusCell && statusCell.v === 'Pending') {
              // Apply red background fill to all cells in that row
              for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
                if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' }; // Create cell if it doesn't exist
                // Apply fill style
                ws[cellAddress].s = { // 's' is for style
                  fill: {
                    patternType: "solid", // Required for fgColor
                    fgColor: { rgb: "FFFF0000" } // Red in ARGB format (Alpha Red Green Blue)
                    // bgColor: { rgb: "FFFF0000" } // Optional: You usually only need fgColor
                  }
                  // You can add other styles like font, border here if needed
                };
              }
            }
          }
      }
      // --- End Styling ---


        // Calculate column widths dynamically
        const colWidths = reportData.reduce((widths, row) => {
            Object.entries(row).forEach(([key, value], i) => {
            const len = Math.max((value ? String(value).length : 0), key.length);
            widths[i] = Math.max(widths[i] || 10, len + 2); // Min width 10, add padding
            });
            return widths;
        }, [] as number[]);
        ws['!cols'] = colWidths.map(w => ({ wch: w })); // wch = width in characters


      // Create workbook and add worksheet
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Return Status Report");

      // Generate filename and download
      const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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
        <h1 className="text-3xl font-bold text-center mb-8 text-primary">ReturnVerify</h1>

      {/* File Upload Card */}
      <Card className="shadow-lg rounded-lg overflow-hidden">
        <CardHeader className="bg-secondary">
          <CardTitle className="text-xl md:text-2xl font-semibold text-secondary-foreground flex items-center gap-3">
            <Upload className="h-6 w-6" /> Upload Return Data
          </CardTitle>
          <CardDescription className="text-secondary-foreground pt-1">
             Upload Excel (.xlsx). Expects AWB in Col F, Courier below AWB (Col F), Return Type (auto-detected). Details (Product, Suborder ID, etc.) from merged group start row.
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

      {/* Verification Card - Only show if file is uploaded */}
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
             {/* Input field for AWB */}
             <label htmlFor="awb-input" className="block text-sm font-medium text-foreground mb-2">Enter AWB Number:</label>
            <Input
              id="awb-input"
              type="text"
              placeholder="Scan or type AWB Number here..."
              value={currentAwb}
              onChange={handleAwbInputChange}
              disabled={awbList.length === 0} // Disable if no list loaded
              className="text-base p-3 h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="AWB Number Input"
              autoComplete="off"
            />
            {/* Loading indicator */}
            {isVerifying && <p className="text-sm text-muted-foreground mt-2 animate-pulse">Verifying...</p>}

             {/* Verification Status Alert */}
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
           {/* Card Footer with stats and download button */}
           <CardFooter className="bg-muted/50 p-4 border-t flex justify-between items-center">
             <p className="text-sm text-muted-foreground">
                 {receivedCount} of {awbList.length} shipment(s) marked as received.
             </p>
              <Button
                  onClick={handleDownloadReport}
                  variant="outline"
                  size="sm"
                  disabled={awbList.length === 0} // Disable if no list
                  className="ml-auto" // Push to the right
               >
                  <Download className="mr-2 h-4 w-4" />
                  Download Report
              </Button>
           </CardFooter>
        </Card>
      )}

      {/* Missing AWB Report Card - Only show if file is uploaded */}
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
              <ScrollArea className="h-[450px] border-t"> {/* Increased height */}
                <Table>
                  <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[150px] font-semibold">AWB Number</TableHead>
                      <TableHead className="font-semibold flex items-center gap-1"><Truck size={16} /> Courier</TableHead>
                       <TableHead className="font-semibold min-w-[250px]"><Package size={16} className="inline mr-1"/> Product Details</TableHead> {/* Icon and min-width */}
                       <TableHead className="font-semibold">Suborder ID</TableHead>
                       <TableHead className="font-semibold">Return Type</TableHead> {/* Added Return Type */}
                       <TableHead className="font-semibold">Delivered On</TableHead>
                       {/* Removed Return Reason and Fee columns for brevity */}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingAwbs.map((item, index) => {
                       const productInfo = parseProductDetails(item.productDetails);
                       return (
                         <TableRow key={`${item.awb}-${index}`} className="hover:bg-muted/30">
                           <TableCell className="font-medium">{item.awb}</TableCell>
                           <TableCell>{item.courierPartner || 'Unknown'}</TableCell>
                            <TableCell className="text-xs"> {/* Smaller font for details */}
                              <div>SKU: {productInfo.sku}</div>
                              <div>Cat: {productInfo.category}</div>
                              <div>Qty: {productInfo.qty} | Size: {productInfo.size}</div>
                            </TableCell>
                           <TableCell>{item.suborderId || '-'}</TableCell>
                           <TableCell>{item.returnType || '-'}</TableCell> {/* Display Return Type */}
                           <TableCell>
                              {item.deliveredOn
                                  ? !isNaN(new Date(item.deliveredOn).getTime())
                                      ? new Date(item.deliveredOn).toLocaleDateString() // Format date
                                      : String(item.deliveredOn) // Keep original if not a date
                                  : '-'}
                           </TableCell>
                         </TableRow>
                       );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              // Show "All Clear" message if no missing AWBs
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
