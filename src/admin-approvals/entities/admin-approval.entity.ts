import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApprovalDecision } from '../../common/enums/approval-decision.enum';
import { Company } from '../../companies/entities/company.entity';
import { User } from '../../users/entities/user.entity';

@Entity('admin_approvals')
export class AdminApproval {
  @PrimaryGeneratedColumn('uuid')
  approvalId: string;

  @Column({ type: 'enum', enum: ApprovalDecision })
  decision: ApprovalDecision;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn()
  date: Date;

  @Column({ type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, (company) => company.approvals, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'varchar', length: 36 })
  adminUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adminUserId' })
  admin: User;
}
