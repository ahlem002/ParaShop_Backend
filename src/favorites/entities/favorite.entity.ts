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
import { Product } from '../../products/entities/product.entity';

@Entity('favorites')
@Unique(['clientId', 'productId'])
export class Favorite {
  @PrimaryGeneratedColumn('uuid')
  favoriteId: string;

  @Column({ type: 'varchar', length: 36 })
  clientId: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client: Client;

  @Column({ type: 'varchar', length: 36 })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @CreateDateColumn()
  createdAt: Date;
}
