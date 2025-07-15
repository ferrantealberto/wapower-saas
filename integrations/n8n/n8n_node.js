import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import axios, { AxiosResponse } from 'axios';

export class WAPower implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WAPower',
    name: 'waPower',
    icon: 'file:wapower.svg',
    group: ['communication'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Invia messaggi WhatsApp tramite WAPower',
    defaults: {
      name: 'WAPower',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'waPowerApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Message',
            value: 'message',
          },
          {
            name: 'Bulk Message',
            value: 'bulkMessage',
          },
          {
            name: 'Statistics',
            value: 'statistics',
          },
          {
            name: 'Webhook',
            value: 'webhook',
          },
        ],
        default: 'message',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['message'],
          },
        },
        options: [
          {
            name: 'Send',
            value: 'send',
            description: 'Invia un messaggio singolo',
            action: 'Send a message',
          },
          {
            name: 'Get Messages',
            value: 'getMessages',
            description: 'Recupera la lista dei messaggi',
            action: 'Get messages',
          },
        ],
        default: 'send',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['bulkMessage'],
          },
        },
        options: [
          {
            name: 'Send Bulk',
            value: 'sendBulk',
            description: 'Invia messaggi multipli',
            action: 'Send bulk messages',
          },
        ],
        default: 'sendBulk',
      },
      // Message Send Properties
      {
        displayName: 'Phone Number',
        name: 'phone',
        type: 'string',
        displayOptions: {
          show: {
            resource: ['message'],
            operation: ['send'],
          },
        },
        default: '',
        required: true,
        description: 'Numero di telefono destinatario (formato: +39123456789)',
      },
      {
        displayName: 'Message',
        name: 'message',
        type: 'string',
        typeOptions: {
          rows: 4,
        },
        displayOptions: {
          show: {
            resource: ['message'],
            operation: ['send'],
          },
        },
        default: '',
        required: true,
        description: 'Testo del messaggio da inviare',
      },
      {
        displayName: 'Priority',
        name: 'priority',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['message'],
            operation: ['send'],
          },
        },
        options: [
          {
            name: 'Low',
            value: 'low',
          },
          {
            name: 'Normal',
            value: 'normal',
          },
          {
            name: 'High',
            value: 'high',
          },
        ],
        default: 'normal',
        description: 'Priorità del messaggio',
      },
      // Bulk Message Properties
      {
        displayName: 'Messages',
        name: 'messages',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: true,
        },
        displayOptions: {
          show: {
            resource: ['bulkMessage'],
            operation: ['sendBulk'],
          },
        },
        default: {},
        options: [
          {
            name: 'message',
            displayName: 'Message',
            values: [
              {
                displayName: 'Phone Number',
                name: 'phone',
                type: 'string',
                default: '',
                required: true,
                description: 'Numero di telefono destinatario',
              },
              {
                displayName: 'Message',
                name: 'message',
                type: 'string',
                typeOptions: {
                  rows: 2,
                },
                default: '',
                required: true,
                description: 'Testo del messaggio',
              },
            ],
          },
        ],
      },
      // Statistics Properties
      {
        displayName: 'Range',
        name: 'range',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['statistics'],
            operation: ['getStats'],
          },
        },
        options: [
          {
            name: 'Today',
            value: 'today',
          },
          {
            name: 'Yesterday',
            value: 'yesterday',
          },
          {
            name: 'Last 7 Days',
            value: 'week',
          },
          {
            name: 'Last 30 Days',
            value: 'month',
          },
        ],
        default: 'today',
        description: 'Periodo per le statistiche',
      },
      // Webhook Properties
      {
        displayName: 'Webhook URL',
        name: 'webhookUrl',
        type: 'string',
        displayOptions: {
          show: {
            resource: ['webhook'],
            operation: ['create'],
          },
        },
        default: '',
        required: true,
        description: 'URL del webhook',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        displayOptions: {
          show: {
            resource: ['webhook'],
            operation: ['create'],
          },
        },
        options: [
          {
            name: 'Message Sent',
            value: 'message_sent',
          },
          {
            name: 'Message Failed',
            value: 'message_failed',
          },
          {
            name: 'WhatsApp Ready',
            value: 'whatsapp_ready',
          },
          {
            name: 'WhatsApp Disconnected',
            value: 'whatsapp_disconnected',
          },
          {
            name: 'Email Processed',
            value: 'email_processed',
          },
        ],
        default: ['message_sent', 'message_failed'],
        description: 'Eventi per cui ricevere notifiche',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('waPowerApi');
    const apiUrl = credentials.apiUrl as string;
    const apiKey = credentials.apiKey as string;

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    for (let i = 0; i < items.length; i++) {
      const resource = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;

      let response: AxiosResponse;

      try {
        if (resource === 'message') {
          if (operation === 'send') {
            const phone = this.getNodeParameter('phone', i) as string;
            const message = this.getNodeParameter('message', i) as string;
            const priority = this.getNodeParameter('priority', i) as string;

            const body = {
              phone,
              message,
              priority,
            };

            response = await axios.post(`${apiUrl}/api/v1/messages`, body, { headers });
          } else if (operation === 'getMessages') {
            response = await axios.get(`${apiUrl}/api/v1/messages`, { headers });
          }
        } else if (resource === 'bulkMessage') {
          if (operation === 'sendBulk') {
            const messages = this.getNodeParameter('messages', i) as any;
            const body = {
              messages: messages.message || [],
            };

            response = await axios.post(`${apiUrl}/api/v1/messages/bulk`, body, { headers });
          }
        } else if (resource === 'statistics') {
          if (operation === 'getStats') {
            const range = this.getNodeParameter('range', i) as string;
            response = await axios.get(`${apiUrl}/api/v1/stats?range=${range}`, { headers });
          }
        } else if (resource === 'webhook') {
          if (operation === 'create') {
            const webhookUrl = this.getNodeParameter('webhookUrl', i) as string;
            const events = this.getNodeParameter('events', i) as string[];

            const body = {
              url: webhookUrl,
              events,
            };

            response = await axios.post(`${apiUrl}/api/v1/webhooks`, body, { headers });
          } else if (operation === 'delete') {
            const webhookId = this.getNodeParameter('webhookId', i) as string;
            response = await axios.delete(`${apiUrl}/api/v1/webhooks/${webhookId}`, { headers });
          } else if (operation === 'list') {
            response = await axios.get(`${apiUrl}/api/v1/webhooks`, { headers });
          }
        }

        returnData.push({
          json: response!.data,
          pairedItem: {
            item: i,
          },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              error: error.message,
            },
            pairedItem: {
              item: i,
            },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error);
      }
    }

    return [returnData];
  }
}