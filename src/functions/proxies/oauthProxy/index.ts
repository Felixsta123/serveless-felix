import { HttpFunction } from '@google-cloud/functions-framework';

export const oauthProxy: HttpFunction = (req, res) => {
  res.status(501).send({
    message: 'oauthProxy not implemented',
  });
};
