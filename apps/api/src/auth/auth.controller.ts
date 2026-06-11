import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { resolveClientIp, type ClientIpRequest } from '../security/client-ip.util';
import { CurrentUser } from '../security/current-user.decorator';
import { Public } from '../security/public.decorator';
import type { RequestUser } from '../security/request-user.type';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: ClientIpRequest) {
    return this.authService.login(dto, resolveClientIp(req).clientIp ?? undefined);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
