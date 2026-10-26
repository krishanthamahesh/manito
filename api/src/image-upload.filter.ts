import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { MulterError } from 'multer';
import { Response } from 'express';

@Catch(MulterError)
export class ImageUploadExceptionFilter implements ExceptionFilter<MulterError> {
  catch(exception:MulterError,host:ArgumentsHost):void{
    const response=host.switchToHttp().getResponse<Response>();
    if(exception.code==='LIMIT_FILE_SIZE'){
      response.status(413).json({statusCode:413,message:'Images must be 2 MB or smaller.'});
      return;
    }
    response.status(400).json({statusCode:400,message:'The image could not be processed.'});
  }
}
