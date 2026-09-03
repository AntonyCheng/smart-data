import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponse, MeView, RegisterDto } from './auth.types';
import { Public } from './public.decorator';

/** Design §16: POST /auth/login, GET /auth/me. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterDto): Promise<LoginResponse> {
    return this.auth.register(dto);
  }

  @Get('me')
  me(): Promise<MeView> {
    return this.auth.me();
  }
}
