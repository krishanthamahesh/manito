# Software Requirements Specification

## Manito Computerized Maintenance Management System

| Document field | Value |
| --- | --- |
| Version | 0.2 — Implementation baseline |
| Date | 23 October 2026 |
| Status | Implemented baseline; product and production decisions pending |
| Product reference | [Atlas CMMS](https://atlas-cmms.com/) |
| Technology reference | DigiTrend project at `D:\Ceylon Agro IT\Reference\DigiTrend` |

## 1. Introduction

### 1.1 Purpose

This document defines the initial product requirements for Manito, a web-based computerized maintenance management system (CMMS). It describes the target users, scope, employee-entered customer job workflow, operational requirements, quality expectations, and the technology stack to use.

The initial release is centered on shop employees recording jobs requested by customers over the phone or during a shop visit, then scheduling, assigning, and tracking the work. Customers do not log in to or directly use the system. The broader product direction includes work orders, asset management, preventive maintenance, inventory, dashboards, and mobile access, using Atlas CMMS as a functional reference rather than an implementation specification.

### 1.2 Product scope

Manito will provide a shared, searchable system for shop employees to record customer maintenance requests and manage the work that follows. An employee records the customer's details and reported problem during or after a phone call or in-person visit. Employees then review, schedule, assign, and track the resulting job through completion.

The product is intended for maintenance shops and service organizations that need to manage customers, equipment, jobs, and technician work. The first release is a responsive web application for employees; customers are records in the system, not system users. Native mobile applications and offline operation are not part of the MVP.

### 1.3 Definitions

| Term | Definition |
| --- | --- |
| Customer | A person or organization who requests service by phone or in person; a customer does not need a system account. |
| Job | A maintenance need reported by a customer and recorded in Manito by an employee. |
| Work order | A job accepted for maintenance work, with an owner, status, and work history. |
| Asset | Equipment or another maintainable item at a customer location. |
| CMMS | Computerized Maintenance Management System. |
| Tenant | An organization using Manito, with its own users and operational records. |
| MVP | The first releasable scope described in this specification. |

### 1.4 Reference and assumptions

Atlas CMMS is used as a reference for publicly described capabilities: work orders and requests, asset records and history, preventive maintenance, inventory, dashboards, and mobile access. This specification does not assume access to Atlas's private product behavior.

The following are working assumptions for this draft:

1. Customers contact the shop by phone or visit in person; an employee enters each job into Manito.
2. All Manito user accounts belong to shop employees. Customers have no login, portal, or direct job-submission access.
3. A customer job reference may be communicated by an employee; automatic customer notifications and customer self-service tracking are not required for the MVP.
4. Each maintenance organization operates in a separate tenant. Customer and work data must not be visible across tenants.
5. The MVP uses a single business timezone configured for the organization. Multi-timezone scheduling is deferred.

## 2. Overall description

### 2.1 Product perspective

Manito is a browser-based employee application. Employees create customer records and jobs from phone or in-person interactions. A recorded job can be reviewed and managed as a work order, then prioritized, scheduled, assigned, updated, and closed with a record of the work performed.

The system will be delivered as a web application and API backed by PostgreSQL. The application will be deployable as a Docker Compose stack, following DigiTrend's project conventions.

### 2.2 User classes

All user classes below are shop employees with different responsibilities and permissions.

| User class | Main responsibilities |
| --- | --- |
| Shop employee / service advisor | Record a customer's phone or walk-in request, create or find the customer record, capture the issue, and provide the job reference. |
| Dispatcher / maintenance coordinator | Review employee-entered jobs, clarify details with the customer, set priority, schedule work, and assign technicians. |
| Technician | View assigned work, record progress, work performed, time, parts used, and completion details. |
| Maintenance manager | Monitor the queue and work orders, manage staff and operational records, and review performance. |
| Organization administrator | Configure the organization's profile, locations, employee accounts, and roles. |

### 2.3 Operating environment

- Current desktop and mobile web browsers.
- Node.js 22 runtime for application services.
- PostgreSQL 18 database.
- Docker Engine / Docker Desktop with Docker Compose.
- Network access for application use; offline mode is not required for the MVP.

### 2.4 Constraints

- The implementation must use the DigiTrend stack specified in Section 7.
- Tenant-owned data must be tenant-scoped in application access and persistence queries.
- Customer details are business records; only employee accounts can authenticate to Manito.
- The employee workflow for recording phone and walk-in jobs must be usable on desktop and mobile-sized screens.
- Secrets and deployment credentials must be supplied through environment configuration and must not be committed to source control.

## 3. System features and functional requirements

Priority key: **P0** is required for the MVP; **P1** is planned after MVP; **P2** is a future capability.

### 3.1 Employee job intake for phone and shop visits

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-001 | P0 | An authenticated employee shall be able to create a job while handling a customer phone call or in-person shop visit. |
| FR-002 | P0 | The job intake form shall collect the customer's name and available contact details, issue summary, issue description, and service location or equipment drop-off details. |
| FR-003 | P0 | The employee shall be able to find an existing customer or create a customer record during job intake. |
| FR-004 | P0 | The employee shall be able to associate the job with an existing asset when available, or enter a description of the equipment when no asset record exists. |
| FR-005 | P0 | The employee shall be able to record the contact channel (phone or in-person), reported urgency, requested/preferred date, and any initial notes provided by the customer. |
| FR-006 | P0 | The system shall validate required fields and provide actionable field-level validation messages before saving a job. |
| FR-007 | P0 | Employees shall be able to upload and retrieve JPEG, PNG, WebP, and PDF attachments on a work order. Each file shall be limited to 8 MB; a work order may have up to 20 files and 50 MB total. The system shall verify file signatures, restrict access to authenticated employees in the same tenant, and persist attachment data in PostgreSQL. |
| FR-008 | P0 | On successful save, the system shall assign a unique human-readable job reference and display it to the employee for communication to the customer. |
| FR-009 | P0 | The system shall record the employee who created the job, creation time, contact channel, customer, reported issue, and customer-provided urgency. |
| FR-010 | P0 | Customers shall not need or be offered a Manito account or direct-access request form to open a job. |

### 3.2 Job review and work-order lifecycle

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-011 | P0 | Authorized employees shall be able to view and search jobs belonging to their organization. |
| FR-012 | P0 | Employees shall be able to filter the job and work-order queues by status, priority, location, assignee, and date where those fields are applicable. |
| FR-013 | P0 | Employees shall be able to review job details, customer contact information, and the reported equipment and issue. |
| FR-014 | P0 | Employees shall be able to progress a recorded job into a work order without re-entering its customer, equipment, or issue details. |
| FR-015 | P0 | Employees shall be able to place a job on hold pending customer information or decline/cancel it with a recorded reason. Job statuses shall include New, Under Review, Awaiting Customer, Accepted, and Cancelled. |
| FR-016 | P0 | Employees shall be able to set or change the operational priority independently of the customer's reported urgency. |
| FR-017 | P0 | Staff shall be able to assign an accepted work order to a technician and set a planned date. |
| FR-018 | P0 | The work-order lifecycle shall support, at minimum, Open, Assigned, In Progress, On Hold, Completed, and Cancelled states. |
| FR-019 | P0 | Every job and work-order status change shall record the actor, timestamp, previous status, and new status. |
| FR-020 | P0 | A work order shall retain its customer, location, related asset when available, description, priority, assignee, planned date, and completion details. |
| FR-021 | P0 | Authorized staff shall be able to record work notes and completion details on a work order. |
| FR-022 | P0 | Employees shall be able to record dated labor entries (duration and work description) and parts/material entries (item, quantity, and unit) against a work order; the system shall attribute each entry to the recording employee and show labor totals and entry history. |
| FR-023 | P0 | The system shall notify relevant employees when a work order is assigned, rescheduled, or changes status, including completion; notices shall be tenant- and recipient-scoped and support unread counts and read state. |
| FR-039 | P0 | The system shall provide an authenticated employee inbox for recent notices and allow an employee to mark one or all of their notices read. |
| FR-040 | P0 | The system shall create deduplicated notices for overdue assigned work and due preventive maintenance, without repeatedly creating the same reminder for the same work item and due date. |
| FR-041 | P0 | Employees shall be able to print or save as PDF a work-order service report containing shop contact details, customer and equipment details, status, priority, assignment, dates, reported issue, completion notes, recorded labor and materials, and technician signature/date fields. |
| FR-024 | P0 | Employees shall be able to view planned work orders in a weekly calendar, filter the schedule by assignee (including unassigned work), navigate between weeks, and open a work order from the calendar. |

### 3.3 Organization, user, and access management

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-025 | P0 | Staff shall authenticate before accessing organization work queues or customer records. |
| FR-026 | P0 | Administrators shall be able to create tenant-scoped custom roles, select supported permissions for each role, edit or delete custom roles, and assign roles when creating or updating employee accounts. A role assigned to an employee shall take effect on the next authenticated API request. |
| FR-027 | P0 | The system shall enforce permission-based authorization in the API for all protected staff functions, in addition to reflecting allowed sections and actions in the interface. Built-in Employee, Manager, and Administrator roles shall be provisioned with default permissions; built-in roles shall not be edited or deleted. Custom roles shall not receive permission to manage employee accounts, roles, or organization settings. The protected Administrator role shall retain full access, and the organization shall retain at least one active Administrator. |
| FR-028 | P0 | An organization administrator shall be able to configure the organization name, contact phone and email, IANA timezone, and whether phone and shop-visit job intake are enabled. The system shall use the configured timezone for business-date operations and enforce enabled intake channels for all employees. |
| FR-029 | P0 | Customer records shall include one optional postal/service address, editable with the customer's contact details. Organization administrators shall manage tenant-owned service locations; staff shall be able to select an active organization location for any customer's job or enter a one-off service address. Equipment shall retain its own location text. |
| FR-043 | P1 | Administrators shall be able to maintain a tenant-scoped contractor directory with contact details and active state. Authorized staff shall be able to assign a work order to either an active employee or an active contractor; contractor assignment shall be mutually exclusive with employee assignment, recorded in activity history, and contractors shall not require login accounts. |
| FR-030 | P1 | The system shall support asset records associated with a customer and service location, including asset identifier, description, and maintenance history. |

### 3.4 Asset, inventory, preventive maintenance, and reporting

Inventory management and recurring preventive-maintenance plans are included in the current MVP. The remaining capabilities in this section are planned or future enhancements.

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-031 | P1 | Staff shall be able to maintain a searchable asset register and view related work-order history. |
| FR-032 | P2 | The system shall support parent/child asset relationships and QR-code lookup for assets. |
| FR-033 | P0 | Staff shall be able to define, pause, and reactivate recurring maintenance plans for registered equipment, specifying the service instructions, recurrence interval in days, and next due date. The system shall identify due and overdue plans and let staff generate a tenant-scoped work order linked to the customer and asset, scheduled for the due date; generating work shall advance the next due date once and record the resulting work order to prevent duplicate generation. |
| FR-034 | P0 | Staff shall be able to maintain a searchable, tenant-scoped parts catalog with unique SKU, unit, on-hand quantity, and reorder level, record opening stock, receipts, and adjustments with an audit trail, and see low-stock warnings when on-hand quantity is at or below reorder level. |
| FR-038 | P0 | When logging a catalog part on a work order, the system shall use the catalog name and unit and deduct the used quantity atomically, reject insufficient stock without recording a partial use, and retain a linked stock movement. Staff shall also be able to log untracked materials without changing stock. |
| FR-035 | P0 | Authenticated staff shall be able to view a tenant-scoped dashboard of jobs created, open and completed work, overdue and next-30-day scheduled work orders, preventive maintenance due through the selected period, current low-stock items, labor minutes, job status/priority breakdowns, and daily completion trends. |
| FR-036 | P1 | Staff shall be able to filter job reports by date range and status and export the matching job details to CSV. Date ranges shall be validated and report results shall remain tenant-scoped. |
| FR-037 | P2 | The technician experience shall support installable/native mobile use and offline work capture with later synchronization. |
| FR-042 | P1 | Staff shall be able to search existing customers by name, phone number, or email during job intake, and directory views for jobs, customers, contractors, employees, locations, inventory, and equipment shall provide server-side pagination. |

### 3.5 MVP end-to-end workflow

1. A customer phones the shop or visits in person to request maintenance.
2. An employee finds or creates the customer record and records the job, contact channel, equipment, issue, reported urgency, and any requested date.
3. The system validates and saves the job, creates a reference number, and displays it to the employee to share with the customer.
4. An employee reviews the job, clarifies details with the customer as needed, and accepts it for work, places it on hold, or cancels it with a reason.
5. The employee sets operational priority, assignment, and planned date as applicable.
6. The technician records progress and work performed. The coordinator or technician completes the work order with completion details.
7. Employees can retrieve the job and work-order history when the customer calls or visits for an update.

## 4. Data requirements

### 4.1 Core records

The MVP shall persist the following logical records:

- **Tenant / organization:** identity, contact details, timezone, and configuration.
- **User:** tenant association, authentication data, assigned role, and active state.
- **Role:** tenant association, name, description, built-in status, and permission set.
- **Customer:** customer identity and contact details captured by an employee during a phone call or shop visit; customer accounts are not required.
- **Organization location:** a named tenant-owned site with an address and active state, selectable for a job. A customer record has one optional address, and equipment retains its own location text.
- **Asset:** optional equipment identity and relationship to its customer/location.
- **Job:** reference number, customer, employee creator, contact channel, location, optional asset, issue, reported urgency, preferred date, status, creation timestamp, and review history.
- **Work order:** reference number, source job when applicable, customer, location, optional asset, operational priority, status, assignee, planned date, work notes, and completion details.
- **Labor entry:** work order, recording employee, work date, duration in minutes, work description, and creation timestamp.
- **Material-use entry:** work order, recording employee, date used, item name, quantity, unit, optional linked inventory item, optional notes, and creation timestamp. Linked items update stock and create a movement in the same transaction; untracked materials do not affect stock.
- **Inventory item:** tenant, unique SKU, name, unit, on-hand quantity, reorder level, active state, and timestamps.
- **Inventory movement:** tenant, inventory item, movement type, signed quantity, recording employee, optional work order, notes, and creation timestamp. Receipts and adjustments are recorded alongside stock consumption.
- **Preventive maintenance plan:** tenant, customer equipment, plan name and instructions, interval in days, next due date, active state, and timestamps.
- **Preventive maintenance run:** tenant, plan, due date, generated work order, recording employee, and creation timestamp; a plan can generate at most one work order per due date.
- **Audit event:** actor, event type, record, timestamp, and relevant before/after values for tracked changes.

### 4.2 Data rules

- A job may exist without an asset record; it shall be associated with a customer record.
- An organization location shall belong to the same tenant as a job that references it. Deactivating an organization location shall prevent new selection without rewriting existing job location snapshots.
- Every accepted job shall be traceable to its resulting work order.
- Customer-reported urgency and staff-assigned priority shall be stored separately.
- Each tenant-owned record shall be associated with one tenant.
- Work-order status history and audit events shall not be overwritten when records are updated.
- Labor and material-use entries shall remain attributable to the employee who records them and shall contribute to the work order's visible usage history.
- A preventive-maintenance plan shall generate no more than one work order for the same due date; the plan's next date and generated work-order record shall be updated atomically.
- Retention periods, deletion rules, and customer privacy obligations must be agreed before production deployment.

## 5. External interface requirements

### 5.1 User interface

- The employee application shall provide a job/work-order queue, record detail views, and clear status and priority indicators.
- The job intake form shall be quick to use during a phone call or in-person customer visit.
- The interface shall identify validation errors and failed saves; it shall not show a success confirmation unless the job has been saved.
- The initial interface language and any localization requirements are to be confirmed.

### 5.2 API and integrations

- The web application shall communicate with the NestJS API over HTTP using JSON.
- The API shall expose versioned routes, following the DigiTrend convention of `/api/v1`.
- Notification providers, file storage, and third-party integrations are not selected in this draft. Integrations shall be added through configured adapters rather than hard-coded credentials.

## 6. Non-functional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-001 | Security | All authenticated application traffic in production shall use HTTPS. |
| NFR-002 | Security | Passwords shall be stored using a suitable one-way password hash; plaintext passwords shall never be stored or logged. |
| NFR-003 | Security | The API shall authenticate staff requests and authorize access by the assigned role's current permission set and tenant on every protected operation. Permission changes shall be effective without waiting for an old session token to expire. |
| NFR-004 | Security | Job creation and modification endpoints shall require employee authentication and validate and constrain input. File uploads, if enabled, shall enforce configured type and size limits. |
| NFR-005 | Privacy | Only data necessary to record and manage customer jobs shall be collected. Access to customer contact details shall be restricted to authorized employees. |
| NFR-006 | Reliability | A successful job-creation response shall be returned only after the job has been durably saved. |
| NFR-007 | Performance | Under the agreed pilot workload, 95% of ordinary page/API reads should complete within 2 seconds, excluding network latency and external integrations. The workload and measurement environment must be agreed before performance acceptance. |
| NFR-008 | Performance | The system shall return paginated queues and search results rather than requiring an unbounded record list. |
| NFR-009 | Usability | An employee shall be able to record a routine phone or walk-in job using the intake workflow without unnecessary duplicate data entry. |
| NFR-010 | Compatibility | The web interface shall support current stable releases of major desktop and mobile browsers at release time. |
| NFR-011 | Maintainability | API and web code shall use TypeScript, and automated tests shall cover job validation, authorization, and work-order lifecycle behavior. |
| NFR-012 | Deployment | The application shall be buildable and runnable with Docker Compose using documented environment configuration and persistent PostgreSQL storage. |
| NFR-013 | Auditability | Changes to job review decisions, work-order assignments, priorities, statuses, and completion shall be attributable to an employee and timestamp. |
| NFR-014 | Accessibility | Forms and primary workflows shall support keyboard navigation, labels for controls, and understandable error messages. |

## 7. Technology stack and deployment

The system shall reuse DigiTrend's application stack, adapting its domain-specific services and data model to maintenance operations.

| Layer | Technology |
| --- | --- |
| Frontend | React 18.3, TypeScript, Vite 5, React Router 6 |
| Backend API | NestJS 10 with the Express platform adapter |
| Runtime | Node.js 22 |
| Database | PostgreSQL 18 |
| Authentication | JWT for staff sessions; bcryptjs for password hashing |
| Database access | PostgreSQL client library (`pg`), using the project's established query and migration patterns |
| Packaging and local deployment | Docker, Docker Compose, multi-stage Node.js container build |
| Timezone default | `Asia/Colombo`, configurable per organization where supported |

The MVP may run the API and built frontend in one application container alongside PostgreSQL, following the current Manito deployment starter. Background workers may be introduced when notifications, scheduled maintenance, or report generation require them; they are not a prerequisite for initial request intake.

## 8. MVP acceptance criteria

The MVP is acceptable when all of the following can be demonstrated in a clean deployment:

1. An employee can sign in, find or create a customer record, and record a job received by phone or in person.
2. Invalid or incomplete job entries receive clear validation feedback and are not recorded as successful jobs.
3. An employee can view only jobs belonging to their organization.
4. An authorized employee can review a job, place it on hold or cancel it with a reason, or accept it and create a linked work order.
5. Staff can set work-order priority, assign a technician, set a planned date, and update its status through the supported lifecycle.
6. Status and assignment changes are recorded with the responsible user and time.
7. A technician or authorized staff member can record work notes and completion details.
8. The employee job intake and work queue are usable on desktop and mobile browser layouts.
9. Docker Compose starts the application and PostgreSQL with persistent database storage using documented configuration.
10. Automated tests cover employee job creation and validation, tenant isolation, authorization, work-order creation, and status-history recording.
11. Staff can create, pause, and reactivate an equipment maintenance plan; due work can be generated once, linked to its equipment and customer, and assigned the plan's next recurrence date.
12. Inventory receipts, adjustments, low-stock warnings, tracked work-order consumption, insufficient-stock rollback, and untracked material logging behave as specified.
13. Work-order attachments accept only signature-verified JPEG, PNG, WebP, and PDF files within per-file and per-work-order limits; unauthorized or cross-tenant reads are rejected, and stored files remain available after an application restart.
14. Staff can print or save a work-order service report as PDF, including the work details, recorded labor and materials, shop contact details, and technician signature/date fields.
15. Employees, Managers, and Administrators use the same sign-in flow; an Administrator can create a custom role, select its permissions, and assign it to an employee. API requests using the assigned role are allowed or denied by the role's current permission set, and built-in roles and Administrator protections cannot be bypassed.
16. Administrators can create, edit, deactivate, and reactivate organization locations; employees can select an active organization location for any customer's job or enter a one-off service address. Customer contact details and the customer's single address can be edited in the customer form; equipment location text is recorded independently.

### Verification record — 23 October 2026

- API unit tests: 15 passed, including pagination validation/metadata, customer tenant scoping and authorization, job creation and intake-channel validation, contractor assignment constraints, and completion history.
- API test type-check, API production build, and web production build passed.
- A clean Docker Compose stack built and started with generated, process-only credentials. The smoke test verified the web/API health endpoints, administrator sign-in, paginated customer listing, customer creation/search, job creation/search, and record persistence after database and application restarts. The isolated stack, network, and volume were removed after the test.
- This is a verification snapshot, not a claim that all 16 acceptance criteria have passed. Full browser-based workflow, cross-tenant integration, attachment, inventory, preventive-maintenance, notification, and reporting acceptance tests remain to be demonstrated.

## 9. Out of scope for the MVP

- Native iOS or Android application and offline synchronization.
- Automatic background creation of preventive-maintenance work orders without employee review.
- Inventory procurement, stock transfers, and valuation.
- Sensor/IoT integrations, advanced asset analytics, and unlimited custom asset fields.
- Billing, customer quotations, payments, and accounting integrations.
- Automatic customer SMS/email updates through a production provider; employees may communicate updates by phone or in person.
- Multi-language interface, multi-currency accounting, and multi-timezone scheduling.
- Complex service-level agreements, escalation policies, and customer-specific workflow builders.

## 10. Open decisions

The following items need product-owner confirmation before production policy and release acceptance are finalized. Tenant isolation is implemented; a single-tenant-only data model is not an open implementation question.

1. Should employees capture customer consent for follow-up by phone, SMS, or email, and which contact details should be mandatory?
2. Do the current contact-channel, urgency, status, and priority options match the shop's operating policy?
3. What pilot workload and measurement environment should be used to accept the existing 2-second P95 ordinary-read target? A proposed starting point is 5 concurrent users and 10,000 work orders in the pilot dataset; this is not yet an approved performance target.
4. What customer/work-order retention period, deletion process, and applicable privacy requirements should production follow? Proposed starting point, pending approval: retain operational records while the organization account is active, then follow a confirmed export/deletion policy.
5. What backup retention and recovery objectives should production meet? Proposed starting point, pending approval: daily backups retained for 30 days, with a 24-hour RPO and 8-hour RTO.

## 11. References

- Atlas CMMS public overview: <https://atlas-cmms.com/>
- DigiTrend project README and dependency manifests at `D:\Ceylon Agro IT\Reference\DigiTrend`
