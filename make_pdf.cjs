const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
doc.pipe(fs.createWriteStream('src/test-data/invoices/scan_0003.pdf'));

// Header
doc.fontSize(20).text('ACME CORP - IT SOLUTIONS', 50, 50);
doc.fontSize(10)
   .text('123 Tech Boulevard', 50, 75)
   .text('San Francisco, CA 94107', 50, 90)
   .text('VAT/Tax ID: US-991283921', 50, 105);

doc.fontSize(20).text('INVOICE', 400, 50, { align: 'right' });

// Invoice Details Box
doc.fontSize(10)
   .text('Invoice Number: AC-8888', 350, 80)
   .text('Invoice Date: Oct 18, 2026', 350, 95)
   .text('Due Date: Net 30 (Nov 18, 2026)', 350, 110)
   .text('PO Number: PO-55412', 350, 125);

// Bill To
doc.fontSize(12).text('BILL TO:', 50, 150);
doc.fontSize(10)
   .text('GlobalCorp Headquarters', 50, 165)
   .text('Attn: Accounts Payable', 50, 180)
   .text('99 Enterprise Way, Suite 100', 50, 195)
   .text('New York, NY 10001', 50, 210);

// Line Items Table Header
doc.moveTo(50, 250).lineTo(550, 250).stroke();
doc.fontSize(10)
   .text('DESCRIPTION', 50, 260)
   .text('QTY', 350, 260)
   .text('UNIT PRICE', 400, 260)
   .text('TOTAL', 500, 260);
doc.moveTo(50, 275).lineTo(550, 275).stroke();

// Line Items
let y = 290;
doc.text('Cloud Database Migration Services', 50, y)
   .text('1', 350, y)
   .text('$1,200.00', 400, y)
   .text('$1,200.00', 500, y);
y += 20;

doc.text('Annual Support Contract - Tier 2', 50, y)
   .text('1', 350, y)
   .text('$1,000.00', 400, y)
   .text('$1,000.00', 500, y);
y += 20;

doc.text('Server Rack Installation Fee', 50, y)
   .text('1', 350, y)
   .text('$250.00', 400, y)
   .text('$250.00', 500, y);

// Totals
doc.moveTo(350, y + 20).lineTo(550, y + 20).stroke();
doc.fontSize(10)
   .text('Subtotal:', 400, y + 30)
   .text('$2,450.00', 500, y + 30);
doc.text('Tax (0%):', 400, y + 45)
   .text('$0.00', 500, y + 45);

doc.fontSize(12).font('Helvetica-Bold')
   .text('TOTAL DUE:', 400, y + 65)
   .text('$2,450.00', 500, y + 65);

// Footer
doc.font('Helvetica').fontSize(10)
   .text('Please remit payment via wire transfer or ACH within 30 days.', 50, 600)
   .text('Bank details attached in secondary documentation.', 50, 615);

doc.end();
console.log('Detailed PDF generated');
