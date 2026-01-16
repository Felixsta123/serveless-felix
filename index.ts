import { HttpFunction } from '@google-cloud/functions-framework';

export const hello: HttpFunction = (req, res) => {
  console.log('Hello World function triggered');
  res.status(200).send({
    message: 'Hello World from Serverless TypeScript!',
    input: req.body,
  });
};
