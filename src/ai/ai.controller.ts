import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  chat(@Body() dto: AiChatDto, @Req() req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0] : null) ||
      req.ip ||
      'anonymous';
    return this.aiService.chat(dto, ip.trim());
  }
}
