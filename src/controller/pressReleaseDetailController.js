import * as model from '../model/pressReleaseDetailModel.js';
import { sendSuccess } from '../utils/response.js';

export async function getDetail(req, res, next) {
  try {
    const data = await model.findDetailByEvent(Number(req.params.id));
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function createDetail(req, res, next) {
  try {
    const body = { ...req.body, event_id: Number(req.body.event_id) };
    const row = await model.createDetail(body);
    sendSuccess(res, row, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateDetail(req, res, next) {
  try {
    const row = await model.updateDetail(Number(req.params.id), req.body);
    sendSuccess(res, row);
  } catch (err) {
    next(err);
  }
}
