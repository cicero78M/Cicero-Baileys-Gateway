import * as logModel from '../model/changeLogModel.js';
import { sendSuccess } from '../utils/response.js';

export async function getLogs(req, res, next) {
  try {
    const data = await logModel.getLogsByEvent(Number(req.params.id));
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function addLog(req, res, next) {
  try {
    const body = {
      ...req.body,
      event_id: Number(req.params.id),
      user_id: req.penmasUser.user_id
    };
    const log = await logModel.createLog(body);
    sendSuccess(res, log, 201);
  } catch (err) {
    next(err);
  }
}
