// src/components/ReturnVerification.tsx
"use client";

import { useState, useCallback, ChangeEvent, useMemo } from "react";
import * as XLSX from "xlsx";
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
  courierPartner?: string; // Added courier partner field
  received: boolean;
}

type VerificationStatus = 'success' | 'error' | 'info' | 'idle';

// Basic function to determine courier partner based on AWB format
// This is a simplified example and might need adjustments based on actual AWB patterns
const getCourierPartner = (awb: string): string => {
    if (!awb) return 'Unknown';
    const cleanedAwb = awb.trim().toUpperCase();

    // Example patterns (these are indicative and may vary)
    if (/^\d{12}$/.test(cleanedAwb)) return 'Delhivery'; // Example: 12 digits numeric
    if (/^\d{10}$/.test(cleanedAwb)) return 'Ecom Express'; // Example: 10 digits numeric
    if (/^\d{14}$/.test(cleanedAwb)) return 'Xpressbees'; // Example: 14 digits numeric
    if (/^\d{11}$/.test(cleanedAwb)) return 'Blue Dart'; // Example: 11 digits numeric
    if (/^[A-Z]\d{8}$/.test(cleanedAwb)) return 'DTDC'; // Example: X12345678
    if (cleanedAwb.startsWith('FMPC')) return 'Ekart'; // Example: Flipkart Ekart
    if (/^[A-Z0-9]{9,15}$/.test(cleanedAwb)) return 'Shadowfax'; // Example: Alphanumeric, adjust length as needed

    // Add more rules as needed

    return 'Unknown'; // Default if no pattern matches
}

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
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // Use defval: '' to ensure empty cells become empty strings
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });

        // Find the header row to locate 'AWB Number' column dynamically
        const headerRowIndex = jsonData.findIndex(row => row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number')));
        if (headerRowIndex === -1) {
            throw new Error("Header row containing 'AWB Number' not found.");
        }
        const headerRow = jsonData[headerRowIndex];
        const awbColumnIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('awb number'));

        if (awbColumnIndex === -1) {
          throw new Error("'AWB Number' column not found in the header.");
        }

        // Find indices for other optional columns
        const productDetailsIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('product details'));
        const suborderIdIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('suborder id'));
        const returnReasonIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('return reason'));
        const feeIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('return shipping fee'));
        const deliveredIndex = headerRow.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('delivered on'));


        const extractedData: ReturnItem[] = jsonData
          .slice(headerRowIndex + 1) // Start processing data rows after the header
          .map((row) => {
            const awbValue = (row[awbColumnIndex] ?? '').toString().trim();
            return {
              productDetails: productDetailsIndex !== -1 ? (row[productDetailsIndex] ?? '').toString() : '',
              suborderId: suborderIdIndex !== -1 ? (row[suborderIdIndex] ?? '').toString() : '',
              returnReason: returnReasonIndex !== -1 ? (row[returnReasonIndex] ?? '').toString() : '',
              returnShippingFee: feeIndex !== -1 ? row[feeIndex] ?? '' : '',
              deliveredOn: deliveredIndex !== -1 ? row[deliveredIndex] ?? '' : '',
              awb: awbValue,
              courierPartner: getCourierPartner(awbValue), // Determine courier partner
              received: false,
            };
          })
          .filter((item) => item.awb); // Filter out rows without AWB

        if (extractedData.length === 0) {
          toast({
            title: "No Data Found",
            description: `No valid AWB numbers found in the '${headerRow[awbColumnIndex]}' column. Please check the file.`,
            variant: "destructive",
          });
          setFileName(null); // Clear filename if no data
        } else {
          setAwbList(extractedData);
          toast({
            title: "File Processed Successfully",
            description: `${extractedData.length} AWB entries loaded from ${file.name}.`,
          });
        }
        // Reset input value to allow re-uploading the same file
        event.target.value = '';

      } catch (error: any) {
        console.error("Error processing file:", error);
        toast({
          title: "File Processing Error",
          description: error.message || "Could not process the Excel file. Ensure it's valid and the 'AWB Number' column exists.",
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
    if (newAwb.length >= 3 && awbList.length > 0) {
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
            Upload an Excel file (.xlsx). Ensure 'AWB Number' column is present.
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
              Loaded: <span className="font-medium">{fileName}</span> ({awbList.length} AWB entries found)
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
                 {receivedCount} of {awbList.length} item(s) marked as received.
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
              AWB numbers from the sheet that have not been scanned/verified.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0"> {/* Remove padding to allow ScrollArea to fill */}
            {missingAwbs.length > 0 ? (
              <ScrollArea className="h-[350px] border-t">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[180px] font-semibold">AWB Number</TableHead>
                      <TableHead className="font-semibold flex items-center gap-1"><Truck size={16} /> Courier</TableHead> {/* Added Courier Column */}
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
                         <TableCell>{item.deliveredOn ? new Date(item.deliveredOn).toLocaleDateString() : '-'}</TableCell>
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
                   {missingAwbs.length} missing item(s) listed above. Each represents a separate return shipment based on the AWB.
               </p>
             </CardFooter>
           )}
        </Card>
      )}
    </div>
  );
}
