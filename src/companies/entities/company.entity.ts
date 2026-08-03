import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CompanyType } from '../../common/enums/company-type.enum';
import { VerificationStatus } from '../../common/enums/verification-status.enum';
import { User } from '../../users/entities/user.entity';
import { Category } from '../../categories/entities/category.entity';
import { AdminApproval } from '../../admin-approvals/entities/admin-approval.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  companyId: string;

  @Column({ type: 'varchar', length: 255 })
  companyName: string;

  @Column({ type: 'enum', enum: CompanyType })
  companyType: CompanyType;

  @Column({ type: 'date' })
  establishmentDate: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** Flat delivery fee in TND set by the company (added at checkout). */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  deliveryFee: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  proofDocument: string | null;

  @Column({
    type: 'enum',
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  verificationStatus: VerificationStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'varchar', length: 36, unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToMany(() => Category, (category) => category.companies)
  @JoinTable({
    name: 'company_categories',
    joinColumn: { name: 'companyId', referencedColumnName: 'companyId' },
    inverseJoinColumn: { name: 'categoryId', referencedColumnName: 'categoryId' },
  })
  categories: Category[];

  @OneToMany(() => AdminApproval, (approval) => approval.company)
  approvals: AdminApproval[];

  @OneToMany(() => Product, (product) => product.company)
  products: Product[];
}
