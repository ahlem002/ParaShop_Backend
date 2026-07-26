import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './notification-type.enum';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { NotificationsGateway } from './notifications.gateway';
import { MailService } from '../mail/mail.service';

export interface NotificationResponse {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  relatedId: string | null;
  isRead: boolean;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly gateway: NotificationsGateway,
    private readonly mailService: MailService,
  ) {}

  async createForUser(input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string | null;
    relatedId?: string | null;
  }): Promise<NotificationResponse> {
    const notification = this.notificationsRepository.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      relatedId: input.relatedId ?? null,
      isRead: false,
    });

    const saved = await this.notificationsRepository.save(notification);
    const response = this.toResponse(saved);
    this.gateway.sendToUser(input.userId, response);

    void this.sendEmailForUser(input.userId, {
      title: input.title,
      message: input.message,
      link: input.link,
    });

    return response;
  }

  async notifyAdmins(input: {
    type: NotificationType;
    title: string;
    message: string;
    link?: string | null;
    relatedId?: string | null;
  }) {
    const admins = await this.usersRepository.find({
      where: { role: Role.ADMIN },
      select: { userId: true, email: true },
    });

    await Promise.all(
      admins.map((admin) =>
        this.createForUser({
          userId: admin.userId,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link,
          relatedId: input.relatedId,
        }),
      ),
    );
  }

  async findForUser(userId: string): Promise<NotificationResponse[]> {
    const items = await this.notificationsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return items.map((item) => this.toResponse(item));
  }

  async countUnread(userId: string): Promise<number> {
    return this.notificationsRepository.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.notificationsRepository.findOne({
      where: { notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    notification.isRead = true;
    const saved = await this.notificationsRepository.save(notification);
    return this.toResponse(saved);
  }

  async markAllAsRead(userId: string) {
    await this.notificationsRepository.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { success: true };
  }

  private async sendEmailForUser(
    userId: string,
    input: { title: string; message: string; link?: string | null },
  ) {
    const user = await this.usersRepository.findOne({
      where: { userId },
      select: { userId: true, email: true },
    });
    if (!user?.email) return;

    await this.mailService.sendNotificationEmail({
      to: user.email,
      title: input.title,
      message: input.message,
      link: input.link,
    });
  }

  private toResponse(notification: Notification): NotificationResponse {
    return {
      notificationId: notification.notificationId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      relatedId: notification.relatedId,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
