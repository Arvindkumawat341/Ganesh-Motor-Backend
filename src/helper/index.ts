import { Response } from "express";

export const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

type StatusCode = (typeof STATUS_CODES)[keyof typeof STATUS_CODES];

export function sendSuccessResponse(
  res: Response,
  data: any,
  message: string = "Success",
  statusCode: StatusCode = STATUS_CODES.OK
): void {
  res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function sendErrorResponse(
  res: Response,
  error: Error | { message: string },
  statusCode: StatusCode = STATUS_CODES.INTERNAL_SERVER_ERROR
): void {
  res.status(statusCode).json({
    success: false,
    message: error.message || "An error occurred",
  });
}

// export const statusCode = {
//   ok: 200,
//   created: 201,
//   accepted: 202,
//   no_content: 204,
//   bad_request: 400,
//   unauthorized: 401,
//   forbidden: 403,
//   not_found: 404,
//   method_not_allowed: 405,
//   conflict: 409,
//   unprocessable_entity: 422,
//   internal_server_error: 500,
//   not_implemented: 501,
//   bad_gateway: 502,
//   service_unavailable: 503,
//   gateway_timeout: 504,
// };
// export default statusCode;

// import {Response} from 'express';
// export default function response(
//   res: Response,
//   status: number,
//   data: unknown,
//   message: string,
// ) {
//   return res.status(status).json({
//     message,
//     data,
//   });
// }
