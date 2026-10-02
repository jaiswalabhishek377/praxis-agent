# Apex Healthcare
## Systems
- ERP Portal: http://localhost:3001
  *(To authenticate, you MUST use the `system_login` tool with `system="erp"`. Do not attempt to type credentials manually, you do not have them).*

## Files
- Invoices are stored locally in: `src/test-data/invoices/`

## Policies
- Dates in the ERP must be formatted as MM/DD/YYYY
- High value transactions (>= $1000) will automatically trigger a human-in-the-loop policy gate.
