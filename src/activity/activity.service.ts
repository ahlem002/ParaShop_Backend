import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityType } from '../common/enums/activity-type.enum';
import { ActivityLog } from './entities/activity-log.entity';

export type ActivitySort = 'newest' | 'oldest';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityRepository: Repository<ActivityLog>,
  ) {}

  async log(input: {
    userId: string;
    type: ActivityType;
    title: string;
    message: string;
    metadata?: Record<string, unknown> | null;
  }) {
    const entry = this.activityRepository.create({
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 160),
      message: input.message.slice(0, 500),
      metadata: input.metadata ?? null,
    });

    try {
      return await this.activityRepository.save(entry);
    } catch {
      // Never break the main action if logging fails
      return null;
    }
  }

  async findMine(
    userId: string,
    limit = 100,
    sort: ActivitySort = 'newest',
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.activityRepository.find({
      where: { userId },
      order: { createdAt: sort === 'oldest' ? 'ASC' : 'DESC' },
      take: safeLimit,
    });

    return rows.map((row) => ({
      activityId: row.activityId,
      type: row.type,
      title: row.title,
      message: row.message,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  }

  async deleteOne(userId: string, activityId: string) {
    const entry = await this.activityRepository.findOne({
      where: { activityId, userId },
    });

    if (!entry) {
      throw new NotFoundException('Activity entry not found');
    }

    await this.activityRepository.remove(entry);
    return { success: true };
  }

  async clearMine(userId: string) {
    const result = await this.activityRepository.delete({ userId });
    return { success: true, deleted: result.affected ?? 0 };
  }
}
