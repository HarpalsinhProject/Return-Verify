# **App Name**: ReturnVerify

## Core Features:

- Excel Upload and Parsing: Upload an Excel file (.xlsx) containing return details, including the AWB number, and store the AWB numbers in memory.
- AWB Verification: Real-time verification of AWB numbers against the uploaded Excel sheet. As the user types an AWB number (minimum 5 characters), the application checks for a match.
- Missing AWB Report: Display a list of AWB numbers from the uploaded Excel sheet that were not found during the AWB verification process.

## Style Guidelines:

- Primary color: White or light grey for a clean and professional look.
- Secondary color: A muted blue (#E3F2FD) for backgrounds or panels.
- Accent: A vibrant green (#4CAF50) to indicate successful matches and a soft red (#F44336) for errors or missing AWB numbers.
- Clear and easily readable sans-serif font.
- Simple and intuitive layout with clear sections for Excel upload, AWB input, and missing AWB display.
- Use recognizable icons for file upload, success, and error states.

## Original User Request:
Project Prompt: Ecommerce Return Verification Web/App

Objective:
Create a web-based or mobile application that helps ecommerce sellers verify received return shipments by comparing input AWB numbers with an uploaded Excel sheet.

Core Functionality:
Excel Upload:

The seller uploads an Excel file with the following columns:

A: Product Details

B: Suborder ID

C: Return Reason

D: Return Shipping Fee

E: Delivered On

F: AWB Number

The application focuses primarily on column F (AWB Number) for matching purposes.

AWB Input & Real-time Verification:

After uploading the sheet, the seller can start typing AWB numbers one by one into an input field.

As soon as the seller enters at least 5 characters, the app should:

Automatically search for a match in column F.

If a match is found:

Mark that AWB number as "Received" in the internal data.

If no match is found, notify the user:

"AWB not found in uploaded list."

No submit/check button required – the system checks automatically after each entry.

Final Output:

After all AWB entries are completed, the app displays a list of AWB numbers from the uploaded Excel that have not been marked as received, indicating they are missing.

User Flow Summary:
Upload Excel sheet with return data.

Input AWB numbers one by one (system checks each in real-time).

View list of unmatched/missing AWB numbers.
  