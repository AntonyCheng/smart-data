export interface AdminUserView {
  id: string;
  account: string;
  name?: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  sessionCount: number;
  lastLoginAt?: Date;
  createdAt: Date;
}

export class UpdateAdminUserDto {
  status?: 'active' | 'disabled';
}

export class CreateAdminUserDto {
  account?: string;
  name?: string;
  password?: string;
}

export class ResetAdminUserPasswordDto {
  newPassword?: string;
}

export interface ResetAdminUserPasswordView {
  reset: true;
}

export interface AdminStatsView {
  totalUsers: number;
  activeUsers: number;
  dailyActiveUsers: number;
  totalSessions: number;
  todaySessions: number;
  totalTokens: number;
  todayTokens: number;
  inputTokens: number;
  outputTokens: number;
  artifactCount: number;
  todayArtifactCount: number;
  categories: Array<{ name: string; count: number }>;
  dailyTokens: Array<{
    date: string;
    label: string;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  topCommands: Array<{ name: string; count: number }>;
  dailyActiveTrend: Array<{ date: string; label: string; count: number }>;
  dailySessionTrend: Array<{ date: string; label: string; count: number }>;
  topUsers: Array<{ userId: string; name: string; account: string; count: number }>;
}
