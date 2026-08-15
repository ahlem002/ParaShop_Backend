import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  clientId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  profileImage: string | null;

  /** Demo-only saved card details for fake checkout prefills (never store real CVV). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  savedCardName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  savedCardNumber: string | null;

  @Column({ type: 'varchar', length: 7, nullable: true })
  savedCardExpiry: string | null;

  @Column({ type: 'varchar', length: 36, unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
