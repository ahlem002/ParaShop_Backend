import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { NotificationResponse } from './notifications.service';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173'],
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.headers.authorization?.replace('Bearer ', '') ??
          undefined);

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<{ sub: string; purpose?: string }>(
        token,
      );

      if (!payload.sub || payload.purpose === '2fa') {
        client.disconnect();
        return;
      }

      client.data.userId = payload.sub;
      await client.join(this.userRoom(payload.sub));
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {
    // room membership is cleaned up automatically
  }

  sendToUser(userId: string, notification: NotificationResponse) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification', notification);
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }
}
