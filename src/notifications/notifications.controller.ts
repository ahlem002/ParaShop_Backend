import {
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.findForUser(user.sub);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.notificationsService.countUnread(user.sub);
    return { count };
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllAsRead(user.sub);
  }

  @Patch(':notificationId/read')
  markAsRead(
    @CurrentUser() user: JwtPayload,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.markAsRead(user.sub, notificationId);
  }
}
