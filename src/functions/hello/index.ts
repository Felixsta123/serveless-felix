import { HttpFunction } from '@google-cloud/functions-framework';

export const hello: HttpFunction = (req, res) => {
  res.status(200).send({
    message: 'Hello World from Serverless!',
    input: req.body ?? null,
  });
};
