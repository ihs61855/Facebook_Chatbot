'use strict';

var Client = require('mongodb').MongoClient;
var cheerio = require('cheerio');
var phantom = require('phantom');
var Forecast = require('forecast');
 
// npm install forecast --save 해야함
var forecast = new Forecast({
  service: 'forecast.io',
  key: '1f27d9cb3004fc05046a80cb13481533',
  units: 'celcius', 
  cache: true,      
  ttl: {            
    minutes: 27,
    seconds: 45
    }
});


var db;

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');

var searchflag=true;
// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
   throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
   throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
   throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if   (!config.NAVER_CLIENT_ID)
{
   throw new Error('missing NAVER_CLIENT_ID');
}
if (!config.NAVER_CLIENT_SECRET)
{
   throw new Error('missing NAVER_CLIENT_SECRET');
}


app.set('port', (process.env.PORT || 80))

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
   extended: false
}))

// Process application/json
app.use(bodyParser.json())

const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
   language: "ko"   
});
const sessionIds = new Map();

app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
   if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
      res.status(200).send(req.query['hub.challenge']);
   } else {
      console.error("Failed validation. Make sure the validation tokens match.");
      res.sendStatus(403);
   }
})

app.post('/webhook', function (req, res) {
  var data = req.body;
  console.log("Webhook received :: " + data);

  // Make sure this is a page subscription
  if (data.object === 'page') {

    // Iterate over each entry - there may be multiple if batched
    data.entry.forEach(function(entry) {
      var pageID = entry.id;
      var timeOfEvent = entry.time;

      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.message) {
          receivedMessage(event);
        } else {
          console.log("Webhook received unknown event: ", event);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know
    // you've successfully received the callback. Otherwise, the request
    // will time out and we will keep trying to resend.
    res.sendStatus(200);
  }
});
  
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;
  
  
  if (!sessionIds.has(senderID)) {
      sessionIds.set(senderID, uuid.v1());
  }

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var messageId = message.mid;

  var messageText = message.text;
  var messageAttachments = message.attachments;
  var food=messageText.indexOf('메뉴추천');
 var weat;
 console.log(messageText);
var seen = {
         recipient : {
            id: senderID
         },
         sender_action:"mark_seen"
      };
      callSendAPI(seen);
      var typingon = {
         recipient : {
            id: senderID
         },
         sender_action:"typing_on"
      };
      callSendAPI(typingon);
   if(food != -1){
    forecast.get([37.5, 127], function(err, weather) {
  if(err) return console.dir(err);
  
  //console.dir(weather.currently);
  if(weather.currently.temperature>0){
      weat=1;
   }
   else{
      weat=2;
   }
     
     //// 날씨 추가
     sendDatabase(senderID, messageText, weat);
     
  });
  
  
 }
 else if (messageText) { 
        sendToApiAi(senderID, messageText);    
  }
}

function sendToApiAi(sender, text) {
   
   var apiaiRequest = apiAiService.textRequest(text, {
      sessionId: sessionIds.get(sender),
      lang: 'ko'
   });

   apiaiRequest.on('response', (response) => {
      handleApiAiResponse(sender, response);      
   });

   apiaiRequest.on('error', (error) => console.error(error));
   apiaiRequest.end();
}

function handleApiAiResponse(sender, response) {
   var responseText = response.result.fulfillment.speech;
   var messages = response.result.fulfillment.messages;
   var action = response.result.action;
   var contexts = response.result.contexts;
   var parameters = response.result.parameters;
   var actionIncompleted = response.result.actionIncomplete;
   
   if(actionIncompleted) sendTextMessage(sender, responseText);
   else{
      switch (action) {
         case "input.meal":
            if(!actionIncompleted){
               var quick = [
                  {
                     "content_type":"text",
                     "title":"족발",
                     "payload":"COURSE_ACTION"
                  },
                  {
                     "content_type":"text",
                     "title":"보쌈",
                     "payload":"COURSE_ACTION"
                  },
                  {
                     "content_type":"text",
                     "title":"치킨",
                     "payload":"COURSE_ACTION"
                  }
                  
               ];
               sendQuickReply(sender, responseText,quick);
            }
            break;
         case "input.program":
            sendProgram(sender,responseText)
            break;
      case "input.search":
         var messageData = {
            recipient: {
               id: sender
            },
            message: {
               text: responseText
            }
         };
       papago(messageData);
         //calladultAPI(messageData);
         break;
       case "input.img":
         sendimgMessage(sender, responseText);
         break;
       case "input.translation":
       var messageData = {
            recipient: {
               id: sender
            },
            message: {
               text: responseText
            }
         };
       papago(messageData);
       break;
        default:
            sendTextMessage(sender, responseText);
      }   
   
   }   
}

function sendQuickReply(recipientId, text, replies, metadata) {
   var messageData = {
      recipient: {
         id: recipientId
      },
      message: {
         text: text,
         metadata: isDefined(metadata)?metadata:'',
         quick_replies: replies
      }
   };

   callSendAPI(messageData);
}


function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}
function sendimgMessage(recipientId, messageText) {
   const  Biryongimg = 'http://blogfiles7.naver.net/20150530_7/nuio4359_14329663081771aUgv_JPEG/%BF%E4%B8%AE%BF%D5_%BA%F1%B7%E6_DVD_%F1%E9%FC%A4%EC%E9%DB%E3%A3%A1_%F0%AF27%FC%A5_%28640x480_XviD_Vorbis%29.mkv_000316562.jpg';
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
        attachment: {
            type: 'image',
            payload: { url: Biryongimg}
        }
    }
  };
  sendTextMessage(recipientId, '전 이렇게 생겼어요');
  callSendAPI(messageData);
  
}
/////////////////// 데이터베이스 추가
function sendDatabase(recipientId, messageText, weat) {
   var message = messageText;
   var time;
   
   function timere() {
      var d = new Date();
      var n = d.getHours(); 
      if(n>=6&&n<=9){
         time=1;
      }
      else if(n>9&&n<=14){
         time=2;
      }
      else if(n>14&&n<=20){
         time=3;
      }
      else{
         time=4;
      }
   } 
   

   timere();
   message = '테스트start'
   Client.connect('mongodb://localhost:27017/Biryong', function(error, db){
      var query = {time:parseInt(time),weather:parseInt(weat)}; // 쿼리 추가
      var gil = 0;
      var cursor = db.collection('foods').find(query);  //길이 구함
      
      cursor.each(function(err,doc){
         if(err){
            console.log(err);
         }
         else{
            if(doc != null){
               gil = gil + 1;
            }
            else {
               var curso = db.collection('foods').find(query).skip(Math.floor(Math.random() * gil)).limit(1);
               curso.each(function(err,doc){
                  if(err){
                     console.log(err);
                  }
                  else{
                     if(doc != null){
                        console.log(doc);
                        var messageData = {
                           recipient: {
                              id: recipientId
                           },
                           message: {
                              text: '이름 : '+doc.name+'\n'+'가격 : '+doc.money+'원\n'+'재료 : '+doc.ingredients+'\n'+'레시피 : '+doc.recipe
                           }
                        }; 
                        callSendAPI(messageData);
                     
                     }
                  }
               });
            }
         }
      });
   });
}

//크롤링 추가
function sendProgram(recipientId, messageText) {
   var message = messageText;
   var airtime = new Array();
var programtitle = new Array();
   var sendmessage = '올리브 티비'+messageText+'일자 편성표 안내 입니다.\n';
   var phInstance, sitepage;
   var url = 'http://olive.tving.com/olive/schedule';

   if(message != '0'){ // 내일
      url += '?startDate=' + message;
   }
   
    phantom.create().then((instance) => {
        phInstance = instance;
        return instance.createPage();
    }).then((page) => {
        sitepage = page;
        return page.open(url);
    }).then((status) => {
        return sitepage.property('content');
    }).then((body) => {
        var $ = cheerio.load(body);
        $('em.airTime').each(function (idx) {            
            var text = $(this).text().trim();
         airtime.push(text);
        })
      $('div.program').each(function (idx) {            
            var text = $(this).attr('title');
         programtitle.push(text);
        })
      /////////////////////////
      if(message == '0'){ // 지금
         var d = new Date();
         var n = parseInt(d.getHours()); 
         var m = parseInt(d.getMinutes());
         var k = n*100+m;

         var ptime = new Array();
         for(var j = 0; j < airtime.length; j++){
            var t = parseInt(airtime[j].substr(0,2))*100;
            t = t + parseInt(airtime[j].substr(3,6));
            ptime.push(t);
         }
   
         for(var j = 0; j < airtime.length-1; j++){
          if(k < ptime[j] && j == 0){
               sendmessage = '현재 올리브 티비에서는 '+programtitle[j]+'이 방송 중입니다.';
               break;
            }
            if(k >= ptime[j] && k < ptime[j+1]){
               sendmessage = '현재 올리브 티비에서는 '+programtitle[j]+'이 방송 중입니다.';
               break;
            }
         }
      }
      else {  //그 외 날자를 받았을 경우
         for(var j = 7; j < airtime.length; j++){
            sendmessage += airtime[j] + ' : ' + programtitle[j]+'\n';
         }
         console.log(sendmessage);
      }
         var messageData = {
      recipient: {
         id: recipientId
      },
      message: {
         text: sendmessage
      }
   }; 
   callSendAPI(messageData);
      /////////////////////////
        sitepage.close().then(() => {
            phInstance.exit();
        })
    }).catch((error) => {
        console.log(error);
        phInstance.exit();
    });

}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: config.FB_PAGE_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s", 
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });  
}
function calladultAPI (messageData) {
    var adultresult;
    var searchreq = {
        query: messageData.message.text,
      };
   var apiurl = 'https://openapi.naver.com/v1/search/adult.json?query=' + encodeURI(searchreq.query);
   var adult = {
      headers: {
         'X-Naver-Client-Id':config.NAVER_CLIENT_ID, 
         'X-Naver-Client-Secret': config.NAVER_CLIENT_SECRET
         },
       url: apiurl
   }
   request(adult, function(error, response, adult){
      var adultresult = JSON.parse(adult);
      console.log(adultresult.adult);
      if(adultresult.adult!=1)
      {
         callsearhAPI(messageData);
      }
      else{
         messageData.message.text = '성인 검색어를 입력하셨습니다.';
         callSendAPI(messageData);
      }
      
   });
}
function callsearhAPI (messageData) {
   var blogbody;
   var resultm;
   var apiurl; 
   var searchreq = {
        query: messageData.message.text,
        sort: 'sim'
      };


   apiurl = 'https://openapi.naver.com/v1/search/encyc.json?query=' + encodeURI(searchreq.query)+'&display:10&start:1&sort:sim';
   var options = {
      headers: {
         'X-Naver-Client-Id':config.NAVER_CLIENT_ID, 
         'X-Naver-Client-Secret': config.NAVER_CLIENT_SECRET
         },
      url: apiurl
   }
   var mdata = cloneObj(messageData);
   request(options, function(error, response, body){
      blogbody = JSON.parse(body);
      resultm ='1.'+strip_tags(blogbody["items"][0]["title"])+'\n'
     +blogbody["items"][0]["link"]+'\n'+'2.'+strip_tags(blogbody["items"][1]["title"])+'\n'
     +blogbody["items"][1]["link"]+'\n'+'3.'+strip_tags(blogbody["items"][2]["title"])+'\n'+blogbody["items"][2]["link"];
      mdata.message.text=resultm;
      callSendAPI(mdata);
   });
   
}

function papago(messageData){
   var api_url = 'https://openapi.naver.com/v1/papago/n2mt';
   var options = {
      headers: {'X-Naver-Client-Id':config.NAVER_CLIENT_ID, 
         'X-Naver-Client-Secret': config.NAVER_CLIENT_SECRET
       },
       url: api_url,
       form: {'source':'ko', 'target':'en', 'text': messageData.message.text}
       
    };
   request.post(options, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var objBody = JSON.parse(response.body);
      var mdata = cloneObj(messageData);
      var resultm = messageData.message.text+'의 번역 결과는 '+objBody.message.result.translatedText +'입니다.';
      mdata.message.text=resultm;
        callSendAPI(mdata);
      } else {
        console.log('번역 실패');
      }
   });
   

}

function strip_tags (str) {
    return str.replace(/(<([^>]+)>)/ig,"");
}

function cloneObj(o){
  var n = {
     recipient:{id: null},
     message:{text: null}
         };
  n.recipient.id = o.recipient.id;
  n.message.text = o.message.text;
  return n;
}

function isDefined(obj) {
   if (typeof obj == 'undefined') {
      return false;
   }

   if (!obj) {
      return false;
   }

   return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
})