-- Демо-цепочка для раздела «Цепочки» (docker-профиль)
INSERT INTO app.journeys (id, name, definition, updated_by)
VALUES (
  'demo-welcome',
  'Welcome-цепочка (демо)',
  '{
    "nodes": [
      {"id":"n1","day":0,"channel":"sms","templateCode":"3","title":"welcome","note":"Приветственное SMS сразу после подписки","active":true,"posX":60,"posY":120},
      {"id":"n2","day":1,"channel":"email","templateCode":"12","title":"welcome","note":"Письмо с подборкой (letteros)","active":true,"posX":380,"posY":60},
      {"id":"n3","day":3,"channel":"sms","templateCode":"4","title":"reminder","note":"Напоминание, если нет клика по письму","active":true,"posX":380,"posY":220},
      {"id":"n4","day":7,"channel":"push","templateCode":"2","title":"last-call","note":"Финальный пуш с deep link","active":true,"posX":700,"posY":120}
    ],
    "edges": [
      {"from":"n1","to":"n2"},
      {"from":"n1","to":"n3"},
      {"from":"n2","to":"n4"},
      {"from":"n3","to":"n4"}
    ]
  }'::jsonb,
  'seed'
)
ON CONFLICT (id) DO NOTHING;
