# GlobalCorp
## Systems
- ERP Portal: http://localhost:3001
  *(To authenticate, you MUST use the `system_login` tool with `system="erp"`).*
- Healthcare Portal: http://localhost:3002
  *(To authenticate, you MUST use the `system_login` tool with `system="healthcare"`).*

## Files
- Invoices are stored locally in: `src/test-data/invoices/`
- Medical Claims are stored locally in: `src/test-data/claims/`
- Incoming requests (emails/tickets) are stored in: `src/test-data/tickets/`
- File names and file modification dates in these folders are unreliable (they come from automated exports). The real invoice date is written inside each document.

## Policies
- Dates in the ERP must be formatted as MM/DD/YYYY
- Invoices already marked as paid must not be submitted again.
- If a candidate invoice is missing required fields (such as the amount), do not submit it. Process the valid invoice instead, and mention the skipped incomplete invoice by file name in your final summary so Accounts can follow up.
- Irreversible actions (like clicking "Submit", "Approve", or "Pay") will automatically trigger a human-in-the-loop policy gate. You MUST click the button to trigger this gate; do not finish the task without clicking submit.
