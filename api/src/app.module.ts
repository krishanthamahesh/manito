import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomersController } from './customers.controller';
import { ContractorsController } from './contractors.controller';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';
import { InventoryController } from './inventory.controller';
import { InventoryVendorsController } from './inventory-vendors.controller';
import { InventoryBrandsController } from './inventory-brands.controller';
import { JobAttachmentsController } from './job-attachments.controller';
import { JobsController } from './jobs.controller';
import { NotificationsController } from './notifications.controller';
import { OrganizationLocationsController } from './organization-locations.controller';
import { OrganizationSettingsController } from './organization-settings.controller';
import { PreventiveMaintenanceController } from './preventive-maintenance.controller';
import { ReportsController } from './reports.controller';
import { RolesController } from './roles.controller';
import { TeamController } from './team.controller';
@Module({controllers:[AssetsController,AuthController,CustomersController,ContractorsController,HealthController,InventoryController,InventoryVendorsController,InventoryBrandsController,JobAttachmentsController,JobsController,NotificationsController,OrganizationLocationsController,OrganizationSettingsController,PreventiveMaintenanceController,ReportsController,RolesController,TeamController],providers:[AuthService,DatabaseService]})
export class AppModule {}
