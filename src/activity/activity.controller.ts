import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ActivityService, type ActivitySort } from './activity.service';

@Controller('activity')
@UseGuards(AuthGuard('jwt'))
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('mine')
  findMine(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    const parsed = limit ? Number(limit) : 100;
    const order: ActivitySort = sort === 'oldest' ? 'oldest' : 'newest';
    return this.activityService.findMine(
      user.sub,
      Number.isFinite(parsed) ? parsed : 100,
      order,
    );
  }

  @Delete('mine')
  clearMine(@CurrentUser() user: JwtPayload) {
    return this.activityService.clearMine(user.sub);
  }

  @Delete('mine/:activityId')
  deleteOne(
    @CurrentUser() user: JwtPayload,
    @Param('activityId') activityId: string,
  ) {
    return this.activityService.deleteOne(user.sub, activityId);
  }
}
