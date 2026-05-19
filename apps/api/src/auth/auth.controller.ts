import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from '../security/current-user.decorator';
import { Public } from '../security/public.decorator';
import type { RequestUser } from '../security/request-user.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor || req.socket.remoteAddress;

    return this.authService.login(dto, ipAddress?.toString());
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
