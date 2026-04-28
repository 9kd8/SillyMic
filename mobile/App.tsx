import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import {BridgeClient} from './src/bridgeClient';
import {ConnectionStatus} from './src/types';

const APP_VERSION = '0.1.0';
const SCREEN_W = Dimensions.get('window').width;
const ORB_SIZE = Math.min(SCREEN_W * 0.35, 150);
const VIZ_SIZE = ORB_SIZE * 2.4;

const BG = '#060B18';
const ACCENT = '#00C8FF';
const CARD = '#0D1525';
const BORDER = '#172640';

export default function App() {
  const [pcIp, setPcIp] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);

  const clientRef = useRef<BridgeClient | null>(null);
  const pinRef = useRef<TextInput>(null);

  const anims = useRef({
    fadeIn: new Animated.Value(0),
    pulse1: new Animated.Value(0),
    pulse2: new Animated.Value(0),
    pulse3: new Animated.Value(0),
    orbScale: new Animated.Value(1),
    spinVal: new Animated.Value(0),
    livePulse: new Animated.Value(1),
  }).current;

  useEffect(() => {
    clientRef.current = new BridgeClient({
      onStatus: setStatus,
      onError: setError,
      onSessionReady: setSessionId,
      onLevel: setLevel,
    });
    Animated.timing(anims.fadeIn, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
    return () => {
      clientRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'streaming') {
      return;
    }
    const make = (a: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(a, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(a, {toValue: 0, duration: 0, useNativeDriver: true}),
        ]),
      );
    const loops = [
      make(anims.pulse1, 0),
      make(anims.pulse2, 700),
      make(anims.pulse3, 1400),
    ];
    loops.forEach(l => l.start());
    return () => {
      loops.forEach(l => l.stop());
      [anims.pulse1, anims.pulse2, anims.pulse3].forEach(a => a.setValue(0));
    };
  }, [status, anims]);

  useEffect(() => {
    if (status !== 'streaming') {
      return;
    }
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(anims.livePulse, {
          toValue: 0.2,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anims.livePulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    blink.start();
    return () => {
      blink.stop();
      anims.livePulse.setValue(1);
    };
  }, [status, anims]);

  useEffect(() => {
    Animated.spring(anims.orbScale, {
      toValue: 1 + level * 0.18,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [level, anims]);

  useEffect(() => {
    if (status !== 'connecting') {
      return;
    }
    const spin = Animated.loop(
      Animated.timing(anims.spinVal, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spin.start();
    return () => {
      spin.stop();
      anims.spinVal.setValue(0);
    };
  }, [status, anims]);

  const isStreaming = status === 'streaming';
  const isConnecting = status === 'connecting';

  const connectDisabled = useMemo(
    () => !pcIp.trim() || !sessionCode.trim() || isConnecting,
    [pcIp, sessionCode, isConnecting],
  );

  const connect = () => {
    setError('');
    setSessionId('');
    Keyboard.dismiss();
    clientRef.current?.connect({
      pcIp: pcIp.trim(),
      sessionCode: sessionCode.trim(),
      deviceName: 'iPhone',
      appVersion: APP_VERSION,
    });
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
    setSessionId('');
    setLevel(0);
  };

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <Animated.View style={[st.root, {opacity: anims.fadeIn}]}>
        <KeyboardAvoidingView
          style={st.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={st.header}>
            <View style={st.titleRow}>
              <Text style={st.title}>SillyMic</Text>
              {isStreaming && (
                <View style={st.liveBadge}>
                  <Animated.View
                    style={[st.liveDot, {opacity: anims.livePulse}]}
                  />
                  <Text style={st.liveLabel}>LIVE</Text>
                </View>
              )}
            </View>
            <View style={st.statusRow}>
              <View style={[st.statusDot, dotColor(status)]} />
              <Text style={[st.statusText, textColor(status)]}>
                {statusLabel(status)}
              </Text>
            </View>
          </View>

          <View style={st.body}>
            {isStreaming ? (
              <View style={st.streamCol}>
                <View style={st.vizBox}>
                  <PulseRing anim={anims.pulse1} size={ORB_SIZE} />
                  <PulseRing anim={anims.pulse2} size={ORB_SIZE * 0.82} />
                  <PulseRing anim={anims.pulse3} size={ORB_SIZE * 0.64} />
                  <Animated.View
                    style={[
                      st.orb,
                      {transform: [{scale: anims.orbScale}]},
                    ]}>
                    <View style={st.micGroup}>
                      <View style={st.micCapsule} />
                      <View style={st.micArc} />
                      <View style={st.micStem} />
                      <View style={st.micBase} />
                    </View>
                  </Animated.View>
                </View>

                <Text style={st.levelPct}>
                  {Math.round(level * 100)}%
                </Text>
                <View style={st.barWrap}>
                  <View style={st.barTrack}>
                    <View
                      style={[
                        st.barFill,
                        {width: `${Math.min(100, Math.round(level * 100))}%`},
                      ]}
                    />
                  </View>
                </View>
                {sessionId ? (
                  <Text style={st.sessionLabel}>
                    {sessionId.length > 14
                      ? sessionId.slice(0, 14) + '…'
                      : sessionId}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={st.dcBtn}
                  onPress={disconnect}
                  activeOpacity={0.7}>
                  <Text style={st.dcText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            ) : isConnecting ? (
              <View style={st.centerCol}>
                <Animated.View
                  style={[
                    st.spinner,
                    {
                      transform: [
                        {
                          rotate: anims.spinVal.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '360deg'],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <Text style={st.cLabel}>Connecting</Text>
                <Text style={st.cSub}>{pcIp || 'host'}</Text>
                <TouchableOpacity
                  style={st.cancelBtn}
                  onPress={disconnect}
                  activeOpacity={0.7}>
                  <Text style={st.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={st.formCol}>
                  <View style={st.card}>
                    <View style={st.field}>
                      <Text style={st.fLabel}>HOST ADDRESS</Text>
                      <TextInput
                        style={st.fInput}
                        value={pcIp}
                        onChangeText={setPcIp}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="numbers-and-punctuation"
                        placeholder="192.168.x.x"
                        placeholderTextColor="#293D5C"
                        selectionColor={ACCENT}
                        returnKeyType="next"
                        onSubmitEditing={() => pinRef.current?.focus()}
                      />
                    </View>
                    <View style={st.sep} />
                    <View style={st.field}>
                      <Text style={st.fLabel}>SESSION PIN</Text>
                      <TextInput
                        ref={pinRef}
                        style={st.fInput}
                        value={sessionCode}
                        onChangeText={setSessionCode}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="number-pad"
                        maxLength={6}
                        placeholder="000000"
                        placeholderTextColor="#293D5C"
                        selectionColor={ACCENT}
                        returnKeyType="done"
                        onSubmitEditing={
                          connectDisabled ? undefined : connect
                        }
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[st.goBtn, connectDisabled && st.goBtnOff]}
                    onPress={connect}
                    disabled={connectDisabled}
                    activeOpacity={0.8}>
                    <Text
                      style={[
                        st.goText,
                        connectDisabled && st.goTextOff,
                      ]}>
                      Connect
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            )}
          </View>

          {error ? (
            <View style={st.errBox}>
              <Text style={st.errText}>{error}</Text>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Animated.View>
    </SafeAreaView>
  );
}

function PulseRing({anim, size}: {anim: Animated.Value; size: number}) {
  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.2],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 0.1, 1],
    outputRange: [0.4, 0.28, 0],
  });
  return (
    <View
      style={[StyleSheet.absoluteFill, st.centered]}
      pointerEvents="none">
      <Animated.View
        style={[
          st.pulseRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{scale}],
            opacity,
          },
        ]}
      />
    </View>
  );
}

function statusLabel(s: ConnectionStatus) {
  switch (s) {
    case 'idle':
      return 'Ready';
    case 'connecting':
      return 'Connecting';
    case 'streaming':
      return 'Streaming';
    case 'error':
      return 'Disconnected';
  }
}

function dotColor(s: ConnectionStatus) {
  const c =
    s === 'streaming'
      ? '#00E676'
      : s === 'connecting'
        ? '#FFB74D'
        : s === 'error'
          ? '#FF5252'
          : '#3D5371';
  return {backgroundColor: c};
}

function textColor(s: ConnectionStatus) {
  const c =
    s === 'streaming'
      ? '#00E676'
      : s === 'connecting'
        ? '#FFB74D'
        : s === 'error'
          ? '#FF5252'
          : '#5B7394';
  return {color: c};
}

const st = StyleSheet.create({
  safe: {flex: 1, backgroundColor: BG},
  root: {flex: 1, backgroundColor: BG},
  flex: {flex: 1},
  centered: {alignItems: 'center', justifyContent: 'center'},

  header: {paddingHorizontal: 24, paddingTop: 16, paddingBottom: 6},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#E8F0FE',
    letterSpacing: -0.5,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,59,48,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF3B30',
  },
  liveLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FF3B30',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  statusDot: {width: 7, height: 7, borderRadius: 3.5},
  statusText: {fontSize: 14, fontWeight: '500'},

  body: {flex: 1, justifyContent: 'center'},

  formCol: {paddingHorizontal: 24},
  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  field: {paddingHorizontal: 18, paddingVertical: 16},
  fLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3D5B80',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  fInput: {
    fontSize: 22,
    fontWeight: '500',
    color: '#E8F0FE',
    padding: 0,
    letterSpacing: 1,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginHorizontal: 18,
  },
  goBtn: {
    marginTop: 20,
    height: 56,
    borderRadius: 16,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goBtnOff: {backgroundColor: '#101D30'},
  goText: {fontSize: 17, fontWeight: '700', color: BG},
  goTextOff: {color: '#2D4560'},

  centerCol: {alignItems: 'center', gap: 14},
  spinner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: ACCENT,
    borderTopColor: 'transparent',
  },
  cLabel: {fontSize: 20, fontWeight: '600', color: '#E8F0FE'},
  cSub: {fontSize: 14, color: '#3D5B80'},
  cancelBtn: {
    marginTop: 6,
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cancelText: {fontSize: 15, fontWeight: '600', color: '#5B7394'},

  streamCol: {alignItems: 'center', paddingHorizontal: 24, gap: 10},
  vizBox: {
    width: VIZ_SIZE,
    height: VIZ_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: '#091828',
    borderWidth: 2,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.45,
    shadowRadius: 25,
    elevation: 8,
  },
  pulseRing: {
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  micGroup: {alignItems: 'center'},
  micCapsule: {
    width: 20,
    height: 30,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  micArc: {
    width: 32,
    height: 16,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: ACCENT,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    marginTop: -3,
  },
  micStem: {width: 3, height: 10, backgroundColor: ACCENT},
  micBase: {width: 14, height: 3, borderRadius: 1.5, backgroundColor: ACCENT},
  levelPct: {
    fontSize: 44,
    fontWeight: '200',
    color: '#E8F0FE',
    letterSpacing: -1,
  },
  barWrap: {width: '75%'},
  barTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#0C1A2D',
    overflow: 'hidden',
  },
  barFill: {height: '100%', borderRadius: 2.5, backgroundColor: ACCENT},
  sessionLabel: {
    fontSize: 12,
    color: '#2D4A6B',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  dcBtn: {
    marginTop: 4,
    paddingHorizontal: 30,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(255,59,48,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.2)',
  },
  dcText: {fontSize: 15, fontWeight: '600', color: '#FF5252'},

  errBox: {
    marginHorizontal: 24,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,82,82,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,82,82,0.15)',
  },
  errText: {fontSize: 13, color: '#FF8A80', fontWeight: '500'},
});
