import { HttpFunction } from '@google-cloud/functions-framework';

export const webProxy: HttpFunction = (req, res) => {
  res.status(501).send({
    message: 'webProxy not implemented',
  });
};
