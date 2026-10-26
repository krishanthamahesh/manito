import { ArgumentsHost, BadRequestException, Catch, Controller, ExceptionFilter, Get, NotFoundException, Param, Post, Req, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterError } from 'multer';
import { Request, Response } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_JOB_SIZE = 50 * 1024 * 1024;
const MAX_JOB_ATTACHMENTS = 20;

interface UserRequest extends Request { user: AuthUser; }
interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Catch(MulterError)
class MulterUploadExceptionFilter implements ExceptionFilter<MulterError> {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ statusCode: 413, message: 'Files must be 8 MB or smaller.' });
      return;
    }
    response.status(400).json({ statusCode: 400, message: 'The uploaded file could not be processed.' });
  }
}

@Controller('jobs/:jobId/attachments')
@UseGuards(AuthGuard)
export class JobAttachmentsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Req() req: UserRequest, @Param('jobId') jobId: string) {
    requirePermission(req.user,'attachments.read');
    this.validateJobId(jobId);
    const result = await this.db.query(
      `SELECT a.id,a.original_name AS "originalName",a.content_type AS "contentType",a.file_size AS "fileSize",
        a.created_at AS "createdAt",u.full_name AS "uploadedBy"
       FROM job_attachments a
       JOIN jobs j ON j.id=a.job_id AND j.tenant_id=a.tenant_id
       JOIN users u ON u.id=a.uploaded_by AND u.tenant_id=a.tenant_id
       WHERE a.tenant_id=$1 AND a.job_id=$2
       ORDER BY a.created_at DESC`,
      [req.user.tenantId, jobId]
    );
    return result.rows;
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0, parts: 1 } }))
  @UseFilters(MulterUploadExceptionFilter)
  async upload(
    @Req() req: UserRequest,
    @Param('jobId') jobId: string,
    @UploadedFile() file?: UploadedAttachment
  ) {
    requirePermission(req.user,'attachments.write');
    this.validateJobId(jobId);
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const contentType = this.detectContentType(file.buffer);
    if (!contentType || contentType !== file.mimetype) {
      throw new BadRequestException('Only genuine JPEG, PNG, WebP, or PDF files are supported.');
    }
    const originalName = this.sanitizeFilename(file.originalname);

    return this.db.transaction(async client => {
      const job = await client.query(
        'SELECT id FROM jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [jobId, req.user.tenantId]
      );
      if (!job.rowCount) throw new NotFoundException('Work order not found.');

      const usage = await client.query<{ count: string; size: string }>(
        `SELECT count(*)::text AS count,COALESCE(sum(file_size),0)::text AS size
         FROM job_attachments WHERE tenant_id=$1 AND job_id=$2`,
        [req.user.tenantId, jobId]
      );
      if (Number(usage.rows[0].count) >= MAX_JOB_ATTACHMENTS) {
        throw new BadRequestException(`A work order can have at most ${MAX_JOB_ATTACHMENTS} attachments.`);
      }
      if (Number(usage.rows[0].size) + file.size > MAX_JOB_SIZE) {
        throw new BadRequestException('The total attachment size for a work order cannot exceed 50 MB.');
      }

      const inserted = await client.query(
        `INSERT INTO job_attachments(tenant_id,job_id,uploaded_by,original_name,content_type,file_size,content)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,original_name AS "originalName",content_type AS "contentType",file_size AS "fileSize",created_at AS "createdAt"`,
        [req.user.tenantId, jobId, req.user.id, originalName, contentType, file.size, file.buffer]
      );
      await client.query(
        `INSERT INTO job_events(tenant_id,job_id,actor_id,event_type,details)
         VALUES($1,$2,$3,'attachment_added',$4)`,
        [req.user.tenantId, jobId, req.user.id, `Added attachment: ${originalName}`]
      );
      return { ...inserted.rows[0], uploadedBy: req.user.fullName };
    });
  }

  @Get(':attachmentId/content')
  async download(
    @Req() req: UserRequest,
    @Param('jobId') jobId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response
  ): Promise<void> {
    requirePermission(req.user,'attachments.read');
    this.validateJobId(jobId);
    this.validateJobId(attachmentId);
    const result = await this.db.query<{ originalName: string; contentType: string; content: Buffer }>(
      `SELECT original_name AS "originalName",content_type AS "contentType",content
       FROM job_attachments
       WHERE id=$1 AND job_id=$2 AND tenant_id=$3`,
      [attachmentId, jobId, req.user.tenantId]
    );
    const attachment = result.rows[0];
    if (!attachment) throw new NotFoundException('Attachment not found.');

    const encodedName = encodeURIComponent(attachment.originalName).replace(/[!'()*]/g, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    response
      .set({
        'Content-Type': attachment.contentType,
        'Content-Length': attachment.content.length,
        'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      .send(attachment.content);
  }

  private validateJobId(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('Provide a valid work order.');
    }
  }

  private detectContentType(buffer: Buffer): string | null {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
    return null;
  }

  private sanitizeFilename(filename: string): string {
    const sanitized = filename
      .normalize('NFKC')
      .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 180);
    return sanitized || 'attachment';
  }
}
