// js/npc.js - NPC会話システム
'use strict';

const NPCSystem = (() => {

  // 会話フェーズ定数
  const PHASE = {
    GREETING:      'greeting',      // 初対面
    REACTION:      'reaction',      // 性格反応
    CHAI_OFFER:    'chai_offer',    // チャイを渡す提案
    CHAI_GIVEN:    'chai_given',    // チャイを渡した後
    DYNAMIC:       'dynamic',       // Claude API 動的会話
    FAREWELL:      'farewell',      // 別れ
    POST_FAREWELL: 'post_farewell', // 別れ後の再会
  };

  // 別れ後の短い台詞
  const POST_FAREWELL_LINES = {
    amma:      '「……また来たの。\n行きなさい。\n待っていても　来ないものは来ない。\nあんたは行きなさい。」',
    sandeep:   '「……まだいるのか。\n行け。\n俺は　大丈夫だ。\n行け。」',
    raju:      '「まだいるじゃん。\n早く行けよ。\n……気をつけてな。」',
    saraswati: '「……行ってください。\n川が　呼んでいます。」',
  };

  // アクティブな会話状態
  let activeConversation = null;

  /**
   * NPC との会話を開始する
   */
  function startConversation(npcId, gameState) {
    const npc = Story.npcs[npcId];
    if (!npc) return null;

    const progress = gameState.npcProgress[npcId] || 0;
    const personality = gameState.personality || 'A';
    const chaiGiven = gameState.chaiGiven[npcId];

    let phase = PHASE.GREETING;
    if (progress >= 1) phase = PHASE.REACTION;
    if (progress >= 2 && !chaiGiven) phase = PHASE.CHAI_OFFER;
    if (chaiGiven) phase = PHASE.CHAI_GIVEN;
    if (progress >= 4) phase = PHASE.FAREWELL;
    if (progress >= 4 && gameState._farewellSeen?.[npcId]) phase = PHASE.POST_FAREWELL;

    activeConversation = {
      npcId,
      phase,
      personality,
      history: gameState.npcHistory[npcId] || [],
      gameState,
    };

    return buildConversation(activeConversation);
  }

  /**
   * 会話コンテンツを構築する
   */
  function buildConversation(conv) {
    const { npcId, phase, personality, gameState } = conv;
    const npc = Story.npcs[npcId];
    const chaiGiven = gameState.chaiGiven[npcId];

    if (phase === PHASE.GREETING) {
      return {
        speaker: npc.name,
        text: npc.greeting[personality] || npc.greeting['A'],
        choices: [
          { label: '話しかける', action: 'next' },
        ],
      };
    }

    if (phase === PHASE.REACTION) {
      return {
        speaker: npc.name,
        text: npc.personality_response[personality] || npc.personality_response['A'],
        choices: buildNextChoices(npcId, gameState),
      };
    }

    if (phase === PHASE.CHAI_OFFER) {
      const hasMilk = (gameState.inventory.milk || 0) >= 1;
      const hasSpice = hasAnySpice(gameState.inventory);
      const canMakeChai = hasMilk && hasSpice;

      const choices = [];
      if (canMakeChai) {
        choices.push({ label: '☕ チャイを作って渡す', action: 'make_chai' });
      }
      if ((gameState.inventory.chai || 0) >= 1) {
        choices.push({ label: '☕ チャイを渡す', action: 'give_chai' });
      }
      choices.push({ label: 'もっと話す', action: 'dynamic' });
      choices.push({ label: '「……」（黙っている）', action: 'silent' });
      choices.push({ label: 'またあとで', action: 'exit' });

      // スパイスもミルクもない場合のヒント
      const hint = (!hasMilk || !hasSpice)
        ? '\n\n（ミルクとスパイスがあればチャイを作れる）'
        : '';

      return {
        speaker: '',
        text: (npc.offer_narration || npc.background) + hint,
        choices,
      };
    }

    if (phase === PHASE.CHAI_GIVEN) {
      const spice = chaiGiven;
      return {
        speaker: npc.name,
        text: npc.chai_response[spice] || `「……ありがとう。」`,
        choices: [
          { label: '聞く', action: 'dynamic' },
          { label: '黙っている', action: 'silent_deep' },
          { label: '別れを告げる', action: 'farewell' },
        ],
      };
    }

    if (phase === PHASE.FAREWELL) {
      const isNarration = !npc.farewell;
      return {
        speaker: isNarration ? '（ナレーション）' : npc.name,
        text: npc.farewell || npc.farewell_narration || '「……」',
        choices: [
          { label: '旅を続ける', action: 'farewell_exit' },
        ],
        isNarration,
      };
    }

    if (phase === PHASE.POST_FAREWELL) {
      return {
        speaker: npc.name,
        text: POST_FAREWELL_LINES[npcId] || '「……行きなさい。」',
        choices: [
          { label: '行く', action: 'exit' },
        ],
      };
    }

    return null;
  }

  function hasAnySpice(inventory) {
    return ['cardamom','ginger','cinnamon','turmeric'].some(s => (inventory[s] || 0) > 0);
  }

  function buildNextChoices(npcId, gameState) {
    const choices = [
      { label: 'もっと話す', action: 'dynamic' },
      { label: '「……」（黙っている）', action: 'silent' },
      { label: 'またあとで', action: 'exit' },
    ];
    return choices;
  }

  /**
   * プレイヤーのアクションを処理する
   */
  async function handleAction(action, extraData, onUpdate) {
    if (!activeConversation) return null;
    const { npcId, personality, gameState } = activeConversation;
    const npc = Story.npcs[npcId];

    if (action === 'exit') {
      activeConversation = null;
      return { done: true };
    }

    if (action === 'make_chai') {
      return { needMakeChai: true };
    }

    if (action === 'give_chai') {
      const spice = extraData?.spice || gameState.chaiGiven[npcId];
      return {
        updateGame: (gs) => {
          gs.inventory.chai = Math.max(0, (gs.inventory.chai || 0) - 1);
          gs.chaiGiven[npcId] = spice;
          gs.npcProgress[npcId] = Math.max(gs.npcProgress[npcId] || 0, 3);
        },
        dialogue: {
          speaker: '（ナレーション）',
          text: `チャイを${npc.name}に渡した。`,
          choices: [{ label: '続きを見る', action: 'chai_response' }],
        },
      };
    }

    if (action === 'chai_response') {
      activeConversation.phase = PHASE.CHAI_GIVEN;
      return { dialogue: buildConversation(activeConversation) };
    }

    if (action === 'farewell') {
      activeConversation.phase = PHASE.FAREWELL;
      // 別れ際のアイテム付与
      const farewellItems = {
        amma:      'wooden_doll',
        sandeep:   'spice_from_sandeep',
        raju:      'stone_from_raju',
        saraswati: null,
      };
      const giftKey = farewellItems[npcId];
      return {
        updateGame: (gs) => {
          gs.npcProgress[npcId] = Math.max(gs.npcProgress[npcId] || 0, 4);
          if (giftKey && !gs.inventory[giftKey]) {
            gs.inventory[giftKey] = 1;
          }
          // ヴィヴェーカ増加
          gs.status.viveka = Math.min(100, (gs.status.viveka || 0) + 10);
        },
        dialogue: buildConversation(activeConversation),
      };
    }

    if (action === 'farewell_exit') {
      activeConversation = null;
      return {
        updateGame: (gs) => {
          if (!gs._farewellSeen) gs._farewellSeen = {};
          gs._farewellSeen[npcId] = true;
        },
        done: true,
      };
    }

    if (action === 'next') {
      activeConversation.phase = PHASE.REACTION;
      return {
        updateGame: (gs) => { gs.npcProgress[npcId] = Math.max(gs.npcProgress[npcId] || 0, 1); },
        dialogue: buildConversation(activeConversation),
      };
    }

    if (action === 'silent' || action === 'silent_deep') {
      const silentResponse = getSilentResponse(npcId, action === 'silent_deep');
      activeConversation.history.push({ role: 'user', content: '（沈黙）' });
      activeConversation.history.push({ role: 'assistant', content: silentResponse });
      return {
        updateGame: (gs) => {
          gs.npcProgress[npcId] = Math.max(gs.npcProgress[npcId] || 0, 2);
          gs.npcHistory[npcId] = activeConversation.history;
          gs.status.chitta = Math.min(100, (gs.status.chitta || 50) + 3);
          gs.status.viveka = Math.min(100, (gs.status.viveka || 0) + 2);
        },
        dialogue: {
          speaker: npc.name,
          text: silentResponse,
          choices: buildNextChoices(npcId, gameState),
        },
      };
    }

    if (action === 'dynamic') {
      // Claude API 動的生成を試みる
      if (onUpdate) onUpdate({ loading: true });

      const chaiSpice = gameState.chaiGiven[npcId];
      const response = await API.generateNPCResponse(
        npcId, personality, chaiSpice,
        activeConversation.history, gameState
      );

      const text = response || getFallbackResponse(npcId, personality, activeConversation.history.length);

      activeConversation.history.push({ role: 'user', content: `（チャイが${personality === 'A' ? '積極的に' : personality === 'B' ? '優しく' : '静かに'}関わる）` });
      activeConversation.history.push({ role: 'assistant', content: text });

      const progress = (gameState.npcProgress[npcId] || 0);

      return {
        updateGame: (gs) => {
          gs.npcProgress[npcId] = Math.max(progress + 1, 2);
          gs.npcHistory[npcId] = activeConversation.history;
          gs.status.chitta = Math.min(100, (gs.status.chitta || 50) + 2);
        },
        dialogue: {
          speaker: npc.name,
          text,
          choices: progress >= 3
            ? [
                { label: 'もう少し話す', action: 'dynamic' },
                { label: '別れを告げる', action: 'farewell' },
              ]
            : buildNextChoices(npcId, gameState),
        },
      };
    }

    return null;
  }

  function getSilentResponse(npcId, deep) {
    const responses = {
      amma: deep
        ? '「……あんた、変な子ね。\nまあ、座ってなさい。」'
        : '「何？言いたいことがあるなら言いなさいよ。」',
      sandeep: deep
        ? '「……お前は師匠みたいだ。\n何も言わないところが。」'
        : '「……そうか。」',
      raju: deep
        ? '「……なんか楽になった。\nなんでだろ。」'
        : '「何か言えよ。」',
      saraswati: deep
        ? '「……あなたといると\n何も考えなくなる。\nそれが　怖い。」'
        : '「静かにしてください。」',
    };
    return responses[npcId] || '「……」';
  }

  function getFallbackResponse(npcId, personality, historyLen) {
    const depth = Math.min(Math.floor(historyLen / 2), 6);

    const fallbacks = {
      amma: {
        A: [
          '「なんで急いでるの。\nどこへも行けやしないのに。」',
          '「ラヴィも　あんたみたいに\n元気だった。\n…………。」',
          '「あの子が帰ったら\n怒ろうと思ってたけど。\n今は　もう　いいや。」',
          '「毎朝　海を見てる。\n誰かに言ったことなかった。\nあんたが最初だ。」',
          '「行くんでしょ。\n行きなさい。\n……また来なくてもいいよ。\n来たらいいけど。」',
          '「待つのが　好きなのか嫌いなのか\nもうわからない。\nでも　海は毎日来る。」',
          '「……名前　なんていうの。\n聞かなかったね。\nまあ　いいか。」',
        ],
        B: [
          '「……やさしいね。\nラヴィもそうだった。\n手紙　書いてくれなくなったけど。」',
          '「待つのは　慣れてる。\n海も　毎朝来るもの。\nそういうもんよ。」',
          '「チャイ、うまかった。\n本当のことよ。」',
          '「あんたみたいな子に\n話すつもりじゃなかった。\nでも…まあ　いいか。」',
          '「……今日は　ありがとうね。\n変な子だけど。」',
          '「海を見るとき\n何も考えなくなる時がある。\nそれが　一番楽な時間よ。」',
          '「ラヴィに会えたら\nこういうこと　話せるかな。\n……話せないかな。」',
        ],
        C: [
          '「黙ってると\n何か考えてるみたいでしょ。\nあんたは何を考えてるの。」',
          '「ラヴィも　静かだった。\nでも目が　話してた。\nあんたも　そうね。」',
          '「……来年　咲く花は\n今年の海が　育てる。\nどこかで聞いた話よ。」',
          '「静かな子は　いいね。\nうるさくしなくていい。」',
          '「……海の向こうに\n何があると思う？\n答えなくていいよ。」',
          '「もう少し　ここにいなさい。\n海が　きれいな時間だから。」',
          '「……ラヴィが　幸せならいい。\n今は　そう思ってる。」',
        ],
      },
      sandeep: {
        A: [
          '「行動するのか。\n師は言った、\n行動は執着だと。\nでも…どうかな。」',
          '「お前みたいに\n動き回るやつを見ると\n昔の自分を思い出す。」',
          '「……俺も　かつては\nどこへでも行けた。\n今は　ここしか　ない。」',
          '「どこへ行こうとしてる。\nどこへでも行け。\n俺には　もうできないから。」',
          '「師が言った。\n『留まることも修行』\nそれを信じすぎた。」',
          '「お前が　羨ましい。\n正直に言う。\n師には　言えなかった。」',
          '「……岩はいつか　崩れる。\n俺も　そうなれるかな。」',
        ],
        B: [
          '「やさしくするな。\n俺は　それに　慣れてない。」',
          '「師は厳しかった。\nでも　正しかった。\n正しすぎて　辛かった。」',
          '「……お前の目が\n何かを見てる。\n俺には　何も見えない。」',
          '「ありがとう。\n言い慣れない言葉だが。」',
          '「師も　こうだったかな。\nやさしかったのか\n厳しかっただけなのか。」',
          '「……涙が出そうになった。\n久しぶりに。\nお前のせいだ。」',
          '「もう少し　話せるか。\n誰とも話さなくなって\n長い。」',
        ],
        C: [
          '「……沈黙が\nいちばん　正直だ。\n師もそう言ってた。」',
          '「お前みたいな子は\n師匠に　向いてる。\n俺には　向いてなかったが。」',
          '「石は　黙って　そこにある。\n俺も　そうなりたかった。\nでも　なれなかった。」',
          '「……何も言わなくていい。\nここに　いてくれるだけで。」',
          '「お前が　帰ったら\nまた一人だ。\n……それでいい。\nそれが俺の場所だ。」',
          '「師の声が聞こえた気がした。\n今日。\n初めて。」',
          '「……ありがとう。\n意味はわからんが\n言いたかった。」',
        ],
      },
      raju: {
        A: [
          '「お前　怖いもんないの？\nうらやましいわ。」',
          '「死体　触ったことあるか。\n冷たいんだよ。\nでも　なんか　穏やかな感じ。」',
          '「働いてる間は　いいんだ。\n夜になって　一人になると。」',
          '「お前みたいな元気なやつが\n羨ましいけど\n俺には　無理だな。」',
          '「どこ行くの　お前。\n遠いとこ？\n……いいな。」',
          '「死ぬのが怖いんじゃなくて\n死んで　何もなくなるのが怖い。\nちょっと違うと思う。」',
          '「また来いよ。\nマジで。\n……来なくてもいいけど。」',
        ],
        B: [
          '「優しいな、お前。\n俺には　珍しい。」',
          '「母ちゃんが死んだとき\n誰も来なかった。\n怖かったのは　それだ。」',
          '「……話してて\n楽になった。\nなんでだろ。」',
          '「また来いよ。\n来なくてもいいけど。」',
          '「お前みたいなやつが\nそばにいたら\n夜も怖くないかも。」',
          '「……ありがとな。\n言い方　知らないけど。」',
          '「川が　好きになった。\n少し。\n前より。」',
        ],
        C: [
          '「何も言わないんだな。\nそれが　一番楽かも。」',
          '「毎晩ガンジスを見る。\n川は　止まらない。\n死体が流れていっても。」',
          '「……お前いると\n怖くなくなる気がする。\nなんでだろ。」',
          '「黙ってる友達って\n初めてかもしれない。」',
          '「……もう少し　いてくれるか。\n川が　暗くなるまで。」',
          '「お前が　帰っても\n川は　ここにある。\nそれで　いい気がしてきた。」',
          '「……怖くなくなった。\n今日だけかもしれないけど。」',
        ],
      },
      saraswati: {
        A: [
          '「あなた、怖くないんですか。\n何も考えずに。」',
          '「行動すれば\n悟りに近づくと思ってた。\n違いましたね。」',
          '「羨ましいです。\n正直に言うと。」',
          '「……あなたを見てると\n力が抜けていく。\nそれが悟りなのかしら。」',
          '「修行を始めたのは\n逃げたかったから　かも。\n今初めて思った。」',
          '「……笑いたくなりました。\n久しぶりに。\nおかしいですか。」',
          '「川が　聞こえますか。\n私には　いつも聞こえすぎて\n疲れていたんです。」',
        ],
        B: [
          '「やさしいですね。\n修行者に　そんな人は\nいないんです。」',
          '「誰かと話すのが\n久しぶりです。\n修行って　孤独なので。」',
          '「……ありがとうございます。\n言う相手が　いなかった。」',
          '「あなたみたいな人と\nもっと話したかった。\n5年前に。」',
          '「……泣きたいです。\n理由は　わかりません。\nあなたがいるから　かも。」',
          '「悟りより　こういう時間の方が\n大切かもしれない。\nそう思っていいですか。」',
          '「……また会えますか。\n会えなくてもいいですが。」',
        ],
        C: [
          '「……静かですね。\n私も　静かでいたいのに。\n頭が　うるさくて。」',
          '「あなたの沈黙は\n私の5年間の修行より\n深い気がする。」',
          '「……何も言わないで\nそこにいてくれると\n楽なんです。」',
          '「プルシャは　すでに自由。\n頭ではわかる。\nでも　感じる前に\n考えてしまう。」',
          '「……眉間の力が\n抜けてきました。\nおかしい。\n何もしていないのに。」',
          '「あなたといると\n求めなくなる。\nそれが　怖かった。\n今は　怖くないです。」',
          '「……Om。\nはじめてそれが\n音じゃなくて　聞こえました。」',
        ],
      },
    };

    const npcFallbacks = fallbacks[npcId];
    if (!npcFallbacks) return '「……」';
    const arr = npcFallbacks[personality] || npcFallbacks['A'];
    return arr[depth] || arr[arr.length - 1];
  }

  function getActiveConversation() { return activeConversation; }
  function clearConversation() { activeConversation = null; }

  return { startConversation, handleAction, getActiveConversation, clearConversation, PHASE };
})();
