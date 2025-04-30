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
import { Upload, CheckCircle, XCircle, AlertTriangle, ScanLine, FileText, Truck, Download, Package, Info } from "lucide-react";

interface ReturnItem {
  awb: string;
  suborderId?: string;
  // Removed productDetails
  sku?: string; // Added
  category?: string; // Added
  qty?: string; // Added
  size?: string; // Added
  returnReason?: string;
  returnShippingFee?: string | number;
  deliveredOn?: string | number | Date;
  courierPartner?: string;
  returnType?: string;
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

  // Helper function to extract value after a keyword (case-insensitive)
  const extractValue = (cellContent: string, keyword: string): string => {
    const lowerContent = cellContent.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const keywordIndex = lowerContent.indexOf(lowerKeyword);
    if (keywordIndex !== -1) {
      let value = cellContent.substring(keywordIndex + keyword.length).trim();
      // Remove leading colon or other separators if present
      if (value.startsWith(':')) {
        value = value.substring(1).trim();
      }
      return value || '-';
    }
    return ''; // Return empty if keyword not found, to distinguish from not finding the cell
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

        if (headerRow.length <= awbColumnIndex || !headerRow[awbColumnIndex].includes('awb number')) {
             throw new Error("Column F (index 5) does not seem to be the 'AWB Number' column based on the header.");
        }
        if (headerRow.length <= suborderIdIndex || !headerRow[suborderIdIndex].includes('suborder id')) {
             console.warn("Column B (index 1) does not seem to be the 'Suborder ID' column based on the header. Shipment grouping might be incorrect.");
        }
        // Dynamically find other columns
        const returnReasonIndex = headerRow.findIndex(cell => cell.includes('return reason'));
        const feeIndex = headerRow.findIndex(cell => cell.includes('return shipping fee'));
        const deliveredIndex = headerRow.findIndex(cell => cell.includes('delivered on'));
        const returnTypeIndex = headerRow.findIndex(cell => cell.includes('return type') || cell.includes('shipment type'));

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
                let size = '-';

                for (let rowIdx = shipmentStartRow; rowIdx <= shipmentEndRow; rowIdx++) {
                    if (rowIdx < jsonData.length && jsonData[rowIdx]?.[productDetailsColumnIndex]) {
                        const cellValue = (jsonData[rowIdx][productDetailsColumnIndex]?.toString() ?? '').trim();
                        if (!cellValue) continue; // Skip empty cells

                         // Try extracting each piece of info. If already found, don't overwrite unless with a non-dash value.
                        let extracted;

                        extracted = extractValue(cellValue, "SKU ID:");
                        if (!extracted) extracted = extractValue(cellValue, "SKU:");
                        if (extracted && (sku === '-' || !sku)) sku = extracted;

                        extracted = extractValue(cellValue, "Category:");
                        if (extracted && (category === '-' || !category)) category = extracted;

                        extracted = extractValue(cellValue, "Qty:");
                        if (!extracted) extracted = extractValue(cellValue, "Quantity:");
                         if (extracted && (qty === '-' || !qty)) qty = extracted;

                         extracted = extractValue(cellValue, "Size:");
                         if (extracted && (size === '-' || !size)) size = extracted;
                    }
                }
                 // --- End Extraction ---


                 // Safe get function for other details (using shipmentStartRow)
                 const detailsRow = jsonData[shipmentStartRow]; // Use start row for general details
                 const safeGet = (index: number) => {
                     const value = detailsRow && index !== -1 && index < detailsRow.length ? detailsRow[index] : null;
                     // Format dates correctly, handle numbers, return strings, default to '-'
                     if (value instanceof Date) {
                         return value.toLocaleDateString(); // Or desired date format
                     }
                     return (value?.toString() ?? '-').trim();
                 };

                 const returnTypeValue = safeGet(returnTypeIndex);

                 const newItem: ReturnItem = {
                     awb: potentialAwb,
                     courierPartner: courierPartnerValue,
                     suborderId: safeGet(suborderIdIndex),
                     sku: sku, // Use extracted value
                     category: category, // Use extracted value
                     qty: qty, // Use extracted value
                     size: size, // Use extracted value
                     returnReason: safeGet(returnReasonIndex),
                     returnShippingFee: safeGet(feeIndex), // Keep as string or number initially
                     deliveredOn: safeGet(deliveredIndex), // Keep raw, format later
                     returnType: returnTypeValue || '-',
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
    const newAwb = event.target.value.trim();
    setCurrentAwb(newAwb);
    setVerificationStatus('idle');
    setVerificationMessage(null);

    // Auto-verify only if input is reasonably long and list exists
    if (newAwb.length >= 5 && awbList.length > 0) {
      setIsVerifying(true);
      // Debounce verification
      const timer = setTimeout(() => {
        const foundIndex = verifyAwb(newAwb);

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
                const displayAwb = actualAwb.toLowerCase() === newAwb.toLowerCase() ? newAwb : `${newAwb} (matched ${actualAwb})`;
                setVerificationMessage(`AWB ${displayAwb} marked as received.`);
                setCurrentAwb(""); // Clear input on success
            } else {
                 // Already received
                 setVerificationStatus('info');
                 const displayAwb = actualAwb.toLowerCase() === newAwb.toLowerCase() ? newAwb : `${newAwb} (matched ${actualAwb})`;
                 setVerificationMessage(`AWB ${displayAwb} was already marked as received.`);
                 // Optionally clear input here too, or leave it for user context
                 // setCurrentAwb("");
            }
        } else {
          // Not found
          setVerificationStatus('error');
          setVerificationMessage(`AWB ${newAwb} not found in the uploaded list or could not be matched.`);
        }
        setIsVerifying(false); // Verification finished
      }, 300); // 300ms debounce

      // Cleanup timeout if input changes before debounce finishes
      return () => clearTimeout(timer);
    } else {
        // Input too short or no list, ensure verifying state is off
        setIsVerifying(false);
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
          case 'success': return <CheckCircle className="h-4 w-4 text-accent" />;
          case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
          case 'info': return <Info className="h-4 w-4 text-blue-500" />;
          default: return null;
       }
  }

  // Updated handleDownloadReport to use new fields
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
            'SKU': item.sku || '-', // Use new field
            'Category': item.category || '-', // Use new field
            'Qty': item.qty || '-', // Use new field
            'Size': item.size || '-', // Use new field
            'Return Type': item.returnType || '-',
            'Suborder ID': item.suborderId || '-',
            'Delivered On': item.deliveredOn
                ? !isNaN(new Date(item.deliveredOn).getTime())
                    ? new Date(item.deliveredOn).toLocaleDateString()
                    : String(item.deliveredOn)
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
                  fill: { patternType: "solid", fgColor: { rgb: "FFFF0000" } } // Red fill
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
            <Upload className="h-6 w-6" /> Upload Return Data
          </CardTitle>
          <CardDescription className="text-secondary-foreground pt-1">
             Upload Excel (.xlsx). Expects: Col F = AWB, Row below AWB in Col F = Courier. Col B = Suborder ID (for grouping). Col A = Product Details (SKU, Cat, Qty, Size in separate rows within group). Col for Return Type (auto-detected).
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
              className="text-base p-3 h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="AWB Number Input"
              autoComplete="off"
            />
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
                   <AlertDescription className="ml-1"> {/* Consider removing ml-1 if icon size is consistent */}
                     {verificationMessage}
                   </AlertDescription>
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
                <Table>
                  <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[150px] font-semibold">AWB Number</TableHead>
                      <TableHead className="font-semibold flex items-center gap-1"><Truck size={16} /> Courier</TableHead>
                      {/* Updated Product Details Header */}
                       <TableHead className="font-semibold min-w-[200px]"><Package size={16} className="inline mr-1"/> Product</TableHead>
                       <TableHead className="font-semibold">Suborder ID</TableHead>
                       <TableHead className="font-semibold">Return Type</TableHead>
                       <TableHead className="font-semibold">Delivered On</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingAwbs.map((item, index) => (
                         <TableRow key={`${item.awb}-${index}`} className="hover:bg-muted/30">
                           <TableCell className="font-medium">{item.awb}</TableCell>
                           <TableCell>{item.courierPartner || 'Unknown'}</TableCell>
                           {/* Updated Product Details Cell */}
                            <TableCell className="text-xs">
                              <div>SKU: {item.sku || '-'}</div>
                              <div>Cat: {item.category || '-'}</div>
                              <div>Qty: {item.qty || '-'} | Size: {item.size || '-'}</div>
                            </TableCell>
                           <TableCell>{item.suborderId || '-'}</TableCell>
                           <TableCell>{item.returnType || '-'}</TableCell>
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
              // "All Clear" message
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
