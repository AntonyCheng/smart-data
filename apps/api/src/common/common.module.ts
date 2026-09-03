import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { IdentityService } from './identity.service';
import { WorkspaceService } from './workspace.service';

@Global()
@Module({
  providers: [
    IdentityService,
    WorkspaceService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [IdentityService, WorkspaceService],
})
export class CommonModule {}
