import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PromotionOfferType } from '../../common/enums/promotion-offer-type.enum';

@Entity('promotion_offers')
export class PromotionOffer {
  @PrimaryGeneratedColumn('uuid')
  offerId: string;

  @Column({ type: 'enum', enum: PromotionOfferType, unique: true })
  offerType: PromotionOfferType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  defaultPrice: number;

  @Column({ type: 'int', default: 7 })
  defaultDurationDays: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
