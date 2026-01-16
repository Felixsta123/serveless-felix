import { HttpFunction } from '@google-cloud/functions-framework';

export const discordProxy: HttpFunction = (req, res) => {
  res.status(501).send({
    message: 'discordProxy not implemented',
  });
};
