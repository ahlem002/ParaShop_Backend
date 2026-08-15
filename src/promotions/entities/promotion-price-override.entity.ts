import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PromotionOfferType } from '../../common/enums/promotion-offer-type.enum';
import { Product } from '../../products/entities/product.entity';
import { User } from '../../users/entities/user.entity';

@Entity('promotion_price_overrides')
export class PromotionPriceOverride {
  @PrimaryGeneratedColumn('uuid')
  overrideId: string;

  @Column({ type: 'enum', enum: PromotionOfferType })
  offerType: PromotionOfferType;

  /** Null = override for the whole offer; set = product-specific. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'int', nullable: true })
  durationDays: number | null;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ type: 'varchar', length: 36 })
  adminUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adminUserId' })
  admin: User;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
