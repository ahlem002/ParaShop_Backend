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
import { Client } from '../../clients/entities/client.entity';
import { Company } from '../../companies/entities/company.entity';
import { User } from '../../users/entities/user.entity';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { OrderItem } from './order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  orderId: string;

  @Column({ type: 'varchar', length: 36 })
  clientId: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client: Client;

  @Column({ type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING_PAYMENT,
  })
  status: OrderStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  deliveryFee: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  /** Amount sent to Flouci in millimes (TND * 1000). */
  @Column({ type: 'int' })
  amountMillimes: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  flouciPaymentId: string | null;

  @Column({ type: 'varchar', length: 100, unique: true })
  trackingId: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  shippingAddress: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  shippingPhone: string | null;

  /** Assigned delivery driver (user with role DELIVERY). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  deliveryUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deliveryUserId' })
  deliveryUser: User | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  deliveryNote: string | null;

  @Column({ type: 'datetime', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  returnedAt: Date | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;
}
