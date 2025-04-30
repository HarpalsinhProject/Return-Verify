"use client";

import { useState, useCallback, ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface ReturnItem {
  awb: string;
  productDetails?: string;
  suborderId?: string;
  returnReason?: string;
  returnShippingFee?: string | number;
  deliveredOn?: string | number | Date;
  received: boolean;
}

export default function ReturnVerification() {
  const [awbList, setAwbList] = useState<ReturnItem[]>([]);
  const [currentAwb, setCurrentAwb] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationMessage, setVerificationMessage] = useState<{ type: 'success' | 'error' | 'info' | null, text: string | null }>({ type: null, text: null });
  const { toast } = useToast();

  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // Assuming AWB is in column F (index 5)
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        const extractedData: ReturnItem[] = jsonData
          .slice(1) // Skip header row
          .map((row) => ({
            productDetails: row[0] ?? '',
            suborderId: row[1] ?? '',
            returnReason: row[2] ?? '',
            returnShippingFee: row[3] ?? '',
            deliveredOn: row[4] ?? '',
            awb: (row[5] ?? '').toString().trim(), // Extract AWB from column F
            received: false,
          }))
          .filter((item) => item.awb); // Filter out rows without AWB

        if (extractedData.length === 0) {
          toast({
            title: "Error Reading File",
            description: "No AWB numbers found in column F. Please check the file format.",
            variant: "destructive",
          });
          setFileName(null);
          setAwbList([]);
        } else {
          setAwbList(extractedData);
          toast({
            title: "File Uploaded",
            description: `${extractedData.length} AWB numbers loaded successfully.`,
          });
        }
        // Reset input value to allow re-uploading the same file
        event.target.value = '';

      } catch (error) {
        console.error("Error processing file:", error);
        toast({
          title: "File Processing Error",
          description: "Could not process the Excel file. Please ensure it's a valid .xlsx file and check the format.",
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
    setCurrentAwb(""); // Clear AWB input on new file upload
    setVerificationMessage({ type: null, text: null }); // Clear verification message
    setIsVerifying(false); // Reset verification state
  }, [toast]);

  const handleAwbInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newAwb = event.target.value.trim();
    setCurrentAwb(newAwb);
    setVerificationMessage({ type: null, text: null }); // Clear message on new input

    if (newAwb.length >= 5 && awbList.length > 0) {
      setIsVerifying(true);
      setTimeout(() => { // Simulate async check / debounce
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
                setVerificationMessage({ type: 'success', text: `AWB ${newAwb} marked as received.` });
                setCurrentAwb(""); // Clear input after successful verification
            } else {
                 setVerificationMessage({ type: 'info', text: `AWB ${newAwb} was already marked as received.` });
            }
        } else {
          setVerificationMessage({ type: 'error', text: `AWB ${newAwb} not found in the uploaded list.` });
        }
        setIsVerifying(false);
      }, 300); // Adjust delay as needed
    } else {
        setIsVerifying(false);
    }
  };

  const missingAwbs = awbList.filter((item) => !item.received);

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="bg-secondary shadow-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary-foreground flex items-center gap-2">
            <Upload className="h-6 w-6" /> Upload Return Data
          </CardTitle>
          <CardDescription className="text-secondary-foreground">
            Upload the Excel sheet (.xlsx) containing return details. Ensure AWB numbers are in Column F.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            id="excel-upload"
            type="file"
            accept=".xlsx"
            onChange={handleFileUpload}
            className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
          />
          {fileName && (
            <p className="text-sm text-muted-foreground mt-2">
              Loaded file: <span className="font-medium">{fileName}</span> ({awbList.length} AWB entries)
            </p>
          )}
        </CardContent>
      </Card>

      {awbList.length > 0 && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-barcode"><path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/></svg>
               Verify Received AWBs
            </CardTitle>
            <CardDescription>
              Enter AWB numbers one by one. Verification starts automatically after 5 characters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              type="text"
              placeholder="Enter AWB Number..."
              value={currentAwb}
              onChange={handleAwbInputChange}
              disabled={awbList.length === 0}
              className="text-lg p-3"
            />
            {isVerifying && <p className="text-sm text-muted-foreground mt-2 animate-pulse">Verifying...</p>}
             {verificationMessage.text && (
                 <Alert
                   variant={verificationMessage.type === 'error' ? 'destructive' : verificationMessage.type === 'success' ? 'default' : 'default'}
                   className={`mt-4 ${verificationMessage.type === 'success' ? 'border-accent text-accent-foreground bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
                                    : verificationMessage.type === 'error' ? 'border-destructive text-destructive-foreground bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
                                    : 'bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'}`} // Using accent for success, destructive for error, default blueish for info
                 >
                   {verificationMessage.type === 'success' && <CheckCircle className="h-4 w-4 text-accent" />}
                   {verificationMessage.type === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                   {verificationMessage.type === 'info' && <AlertTriangle className="h-4 w-4 text-blue-500" />} {/* Use a generic icon for info */}
                   <AlertDescription className="font-medium">
                     {verificationMessage.text}
                   </AlertDescription>
                 </Alert>
             )}
          </CardContent>
           <CardFooter>
             <p className="text-sm text-muted-foreground">
                 {awbList.filter(a => a.received).length} of {awbList.length} items marked as received.
             </p>
           </CardFooter>
        </Card>
      )}

      {awbList.length > 0 && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-destructive" /> Missing AWB Report
            </CardTitle>
            <CardDescription>
              The following AWB numbers from the uploaded sheet have not been marked as received.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {missingAwbs.length > 0 ? (
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-secondary z-10">
                    <TableRow>
                      <TableHead className="w-1/3">AWB Number</TableHead>
                       <TableHead>Product Details</TableHead>
                       <TableHead>Suborder ID</TableHead>
                       <TableHead>Delivered On</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingAwbs.map((item) => (
                      <TableRow key={item.awb}>
                        <TableCell className="font-medium text-destructive">{item.awb}</TableCell>
                         <TableCell>{item.productDetails || '-'}</TableCell>
                         <TableCell>{item.suborderId || '-'}</TableCell>
                         <TableCell>{item.deliveredOn ? new Date(item.deliveredOn).toLocaleDateString() : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <Alert className="bg-green-100 dark:bg-green-900/30 border-accent text-accent-foreground dark:text-green-300 dark:border-green-700">
                 <CheckCircle className="h-4 w-4 text-accent" />
                <AlertDescription className="font-medium">
                  All AWB numbers from the uploaded list have been received.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
           <CardFooter>
             <p className="text-sm text-muted-foreground">
                 {missingAwbs.length} missing item(s).
             </p>
           </CardFooter>
        </Card>
      )}
    </div>
  );
}
