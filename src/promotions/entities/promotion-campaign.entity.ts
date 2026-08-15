import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';
import { PromotionOfferType } from '../../common/enums/promotion-offer-type.enum';
import { PromotionStatus } from '../../common/enums/promotion-status.enum';
import { PromotionCampaignProduct } from './promotion-campaign-product.entity';

@Entity('promotion_campaigns')
export class PromotionCampaign {
  @PrimaryGeneratedColumn('uuid')
  campaignId: string;

  @Column({ type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'enum', enum: PromotionOfferType })
  offerType: PromotionOfferType;

  @Column({
    type: 'enum',
    enum: PromotionStatus,
    default: PromotionStatus.PENDING_PAYMENT,
  })
  status: PromotionStatus;

  @Column({ type: 'int' })
  durationDays: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalPrice: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  priceOverrideReason: string | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  startsAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  endsAt: Date | null;

  @OneToMany(() => PromotionCampaignProduct, (item) => item.campaign, {
    cascade: true,
  })
  products: PromotionCampaignProduct[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
