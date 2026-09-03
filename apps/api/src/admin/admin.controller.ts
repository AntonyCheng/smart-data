import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AdminStatsView,
  AdminUserView,
  ResetAdminUserPasswordView,
  CreateAdminUserDto,
  ResetAdminUserPasswordDto,
  UpdateAdminUserDto,
} from './admin.types';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(): Promise<AdminUserView[]> {
    return this.admin.listUsers();
  }

  @Post('users')
  createUser(@Body() dto: CreateAdminUserDto): Promise<AdminUserView> {
    return this.admin.createUser(dto);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateAdminUserDto): Promise<AdminUserView> {
    return this.admin.updateUserStatus(id, dto?.status);
  }

  @Patch('users/:id/password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetAdminUserPasswordDto): Promise<ResetAdminUserPasswordView> {
    return this.admin.resetUserPassword(id, dto?.newPassword);
  }

  @Delete('users/:id')
  async removeUser(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.admin.removeUser(id);
    return { deleted: true };
  }

  @Get('stats')
  stats(): Promise<AdminStatsView> {
    return this.admin.stats();
  }
}
