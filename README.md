# Manito

Manito is a maintenance-management workspace for shop employees. Staff create customer records and enter jobs received by phone or in person, then track the work through completion. Customers do not sign in to the system.

## Technology

- React 18, TypeScript, Vite
- NestJS 10 API on Node.js 22
- PostgreSQL 18
- Docker Compose

## Run with Docker

1. Copy `.env.example` to `.env`.
2. Set unique values for `POSTGRES_PASSWORD` and `JWT_SECRET`. Set `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters.
3. Start the application from this directory:

   ```powershell
   docker compose -f compose.yaml up --build -d
   ```

4. Open `http://localhost:8180` for this local setup and sign in with the employee credentials from `.env`. The port is configurable with `APP_PORT`; 8080 was already occupied on this machine.
5. Check service status at `http://localhost:8180/api/v1/health` (or the port configured in `.env`).

The database is persisted in the `pgdata` Docker volume. Do not use placeholder secrets outside local development.

## Deploy the frontend to Cloudflare Pages

Create a Cloudflare Pages project by connecting this GitHub repository. Set the production branch to `main`, the root directory to `web`, the build command to `npm run build`, and the build output directory to `dist`. Set the Node.js version to 22 if prompted. Cloudflare Pages will provide a `*.pages.dev` address without requiring a custom domain.

In the Pages project settings, add the build environment variable `VITE_API_BASE_URL` with the public HTTPS origin of the API only, for example `https://api.example.com` (no path or trailing slash). The value is included in the public frontend bundle, so never put passwords, tokens, or other secrets in it. After the first deployment, the Pages project URL can be used as the frontend origin.

The API must be publicly reachable over HTTPS and allow the exact Pages origin through its `CORS_ORIGIN` environment variable (for example, `https://your-project.pages.dev`). GitHub Pages and Cloudflare Pages host only the static frontend; the API and PostgreSQL must remain running on the backend server. Keep PostgreSQL private and do not expose port 5432 to the internet.

## Tests and builds

Run the API tests, test-source type-check, and production build from the API directory:

```powershell
Set-Location api
npm test
npm run test:types
npm run build
```

Build the web application from its directory:

```powershell
Set-Location web
npm run build
```

## Directory search and pagination

Jobs, customers, contractors, employees, organization locations, inventory items, and equipment are fetched in server-paginated pages. List endpoints accept `page` and `pageSize`; the default is page 1 with 25 records, and page size is capped at 100. Responses contain `items`, `total`, `page`, `pageSize`, and `totalPages`. Search is performed by the API, including the customer picker used during job intake. Inventory also supports `lowStockOnly=true`.

## Organization color themes

Administrators can choose a Green, Blue, Violet, or Amber system color theme in Organization settings. The selected palette is saved with the organization and applies to all employees. The light/dark appearance toggle remains a personal browser preference.

## Run services separately for development

Start PostgreSQL and set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the environment. Then run the API:

```powershell
cd api
npm install
npm run dev
```

In a second terminal:

```powershell
cd web
npm install
npm run dev
```

The Vite development server runs on port 5173 and proxies `/api` to `http://localhost:8080`.

## First workflow

1. Sign in as a shop employee.
2. An Administrator can open **Roles & permissions** to create custom roles and select feature permissions. Built-in Employee, Manager, and Administrator roles are protected defaults. In **Employees**, create accounts, open an employee profile to update their name, work email, or role, set a temporary password, and deactivate or reactivate access. Share temporary passwords securely; employees can update their own details, upload a profile picture that is automatically resized to fit 150 x 150 px without cropping, and change their password from the profile menu. Password changes require the current password. Role permission changes apply to the next API request.
3. Add or select a customer.
4. Save the customer's address in their customer record. Register equipment with its make, model, serial number, and location; the customer address is prefilled as the equipment location.
5. Create a job, optionally link registered equipment, and record whether the request came by phone or a shop visit. After saving, note the displayed job reference and share it with the customer if needed.
6. Review new jobs and accept them for work. The accepted job becomes the work order; customer, equipment, issue, and contact details remain attached.
7. Assign an employee or a contractor and set the planned work date. Administrators can manage contractor contacts in **Contractors**; contractors do not sign in. Use **Schedule** to review weekly workload and open work orders.
8. Use **Preventive maintenance** to create and edit recurring plans for registered equipment. Set the service instructions, interval in days, next due date, and the number of completed maintenance work orders before expiry (defaults to 4). Due plans can generate work orders with the asset and planned date attached; plans expire automatically when that many generated work orders are completed. Plans can be paused/reactivated before expiry.
9. Use **Inventory** to create a parts catalog with SKU, unit of measure, opening quantity, reorder level, and optional vendor and brand. Choose a standard unit or enter a custom one. Use the Inventory submenu to manage vendor and brand records, then select them when adding parts. Receive stock or adjust on-hand balances; reductions require a reason. Low-stock items are highlighted.
10. On a work order, log labor time with the work date and task performed. Select a catalog part to deduct its quantity from stock, or choose untracked material to record a part without changing inventory.
11. Record work notes as progress is made. Record a reason when placing work on hold or cancelling it, and add completion details before marking work complete.
12. Use **Reports** to review jobs, open and completed work, overdue and upcoming work, maintenance due, low-stock items, labor totals, status/priority breakdowns, and completion trends for a chosen date range and job status. Export the matching job details as CSV.
13. Use the notification bell to review assignments, schedule and status changes, overdue assigned work, and due preventive maintenance. Open a related work order from the inbox, mark individual notices read, or clear the unread count.
14. An Administrator can use **Organization settings** to update the shop name and contact information, upload a JPEG, PNG, or WebP company logo that is automatically resized to fit 150 x 150 px without cropping, set its IANA timezone, and enable or disable phone and shop-visit job intake. The logo is shown on the login page and on printed work-order service reports.
15. Review activity history, stock movement history, and labor/material summaries.
16. Add JPEG, PNG, WebP, or PDF photos and documents to a work order. Files are stored in PostgreSQL; each file is limited to 8 MB, with up to 20 files and 50 MB total per work order.
17. Choose **Print report** on a job or work order to print or save a service report as PDF. It includes the shop contact, customer and equipment details, status and priority, assignment and dates, reported issue, completion notes, labor, materials, and signature lines.
18. All staff use the same sign-in page. Access is enforced by the API from each employee's assigned role permissions. The built-in Employee role handles day-to-day jobs, customers, equipment, schedules, and work logs. The built-in Manager role also manages inventory, preventive-maintenance plans, and reports. The protected Administrator role has full access, including employee accounts, roles, and organization settings. Administrators can create custom roles, choose feature permissions, and assign roles to employees. Custom roles cannot grant employee/role administration or organization settings management.
19. In **Locations**, an Administrator can add, edit, deactivate, or reactivate organization-owned sites. Select an active organization location for any customer's job, or enter a one-off address for a temporary site or shop drop-off. Customer addresses are managed directly in the customer add/edit form.

Directory lists for jobs, customers, contractors, employees, locations, inventory, and equipment are paginated, with selectable page sizes. During job intake, an existing customer can be found by typing a name, phone number, or email address. When assigning a work order, first choose **Employee** or **Contractor**, then select a matching active assignee.

## Current scope

The current vertical slice includes shared employee login with permission-based authorization; protected built-in Employee, Manager, and Administrator roles; Administrator-managed custom roles and per-feature permissions; employee account/role assignment; organization settings for shop name/contact details/timezone/intake channels; organization-owned locations for job intake; an administrator-managed contractor directory and contractor assignment on work orders; customer records with editable contact details and a single address; phone/walk-in job intake with an organization location or one-off service address; customer equipment and service history with its own location text; the jobs queue; a weekly assignee-filterable work schedule; a work-order lifecycle with status, priority, employee or contractor assignment, planned date, hold/cancellation reasons and completion details; labor and material logs; tenant-scoped photo/document attachments; printable work-order service reports; and activity history. Contractors are contact records without login access. Access checks are enforced by the API against the employee's current role permissions, not trusted session claims. Employees can handle day-to-day customer, equipment, organization location, job, schedule, work-log, attachment, notification, and service-report tasks. The built-in Manager role can additionally manage inventory, preventive-maintenance plans, and reports. The protected Administrator role can also manage employee accounts/roles, contractors, and organization settings. Attachments support JPEG, PNG, WebP, and PDF files (8 MB maximum each, 20 files and 50 MB total per work order) and are persisted in PostgreSQL. Employee notifications include assignment, schedule, status and completion changes, overdue assigned work, and due preventive maintenance, with an employee-scoped inbox and read state. Inventory includes a searchable parts catalog, opening stock, receipts, stock adjustments, low-stock indicators, movement history, and transactional stock deduction when catalog items are used on work orders. Preventive maintenance includes recurring equipment plans with configurable completion limits, automatic expiry after the specified number of completed maintenance work orders, due/overdue visibility, pause/reactivate controls before expiry, and work-order generation. Reports include date/status-filtered job metrics and details, overdue work, maintenance due, current low stock, labor totals, completion trends, and filtered CSV export. Untracked materials can still be logged without changing stock. Other future enhancements are described in [SRS.md](./SRS.md).
