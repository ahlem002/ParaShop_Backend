import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';

@Entity('delivery_ratings')
@Unique(['orderId'])
export class DeliveryRating {
  @PrimaryGeneratedColumn('uuid')
  ratingId: string;

  @Column({ type: 'varchar', length: 36 })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'varchar', length: 36 })
  deliveryUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deliveryUserId' })
  deliveryUser: User;

  @Column({ type: 'varchar', length: 36 })
  clientId: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client: Client;

  @Column({ type: 'tinyint' })
  rating: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
