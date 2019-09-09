/**
 * Copyright 2019 IBM All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const rewire = require('rewire');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const should = chai.should();
chai.use(chaiAsPromised);
const sinon = require('sinon');

const Discovery = rewire('../lib/Discovery');
const Client = require('../lib/Client');
const Discoverer = require('../lib/Discoverer');
const Endorser = require('../lib/Endorser');
const User = rewire('../lib/User');
const TestUtils = require('./TestUtils');

describe('Discovery', () => {
	const cc_query_res = {result: 'cc_query_res',
		cc_query_res: {content: [{
			chaincode: 'mychaincode',
			endorsers_by_groups: {
				g0: {peers: [{
					identity: TestUtils.createSerializedIdentity(),
					membership_info: {payload: TestUtils.createMembership()},
					state_info: {payload: TestUtils.createStateInfo()}
				}]}
			},
			layouts: [
				{quantities_by_group: {g0: 1}}
			]
		}]}
	};
	const members = {result: 'members',
		members: {peers_by_org: {
			msp1: {
				peers: [{
					identity: TestUtils.createSerializedIdentity(),
					membership_info: {payload: TestUtils.createMembership()},
					state_info: {payload: TestUtils.createStateInfo()}
				}]
			}
		}}
	};
	const bad_members = {result: 'members',
		members: {peers_by_org: {
			msp2: {
				peers: [{
					identity: TestUtils.createSerializedIdentity(),
					membership_info: {payload: TestUtils.createMembership()},
					state_info: {payload: TestUtils.createStateInfo()}
				}]
			}
		}}
	};
	const config_result = {result: 'config_result',
		config_result: {
			msps: {
				msp1: TestUtils.createMsp(),
				msp2: TestUtils.createMsp()
			},
			orderers: {
				msp1: TestUtils.createEndpoints('hosta', 2),
				msp2: TestUtils.createEndpoints('hostb', 2)
			}
		}
	};

	TestUtils.setCryptoConfigSettings();

	const client = new Client('myclient');
	client._tls_mutual.clientCertHash = Buffer.from('clientCertHash');
	const channel = client.newChannel('mychannel');

	const user = User.createUser('user', 'password', 'mspid', TestUtils.certificateAsPEM, TestUtils.keyAsPEM);
	const idx = client.newIdentityContext(user);

	let discoverer;
	let discovery;
	let endpoint;

	const endorser = sinon.createStubInstance(Endorser);
	endorser.type = 'Endorser';
	const getEndorser = sinon.stub();

	beforeEach(async () => {
		discoverer = new Discoverer('mydiscoverer', client);
		endpoint = client.newEndpoint({url: 'grpc://somehost.com'});
		discoverer.endpoint = endpoint;
		discovery = channel.newDiscovery('mydiscovery');
		client.getEndorser = getEndorser;
		getEndorser.returns(endorser);
		endorser.connect.resolves(true);
	});

	describe('#constructor', () => {
		it('should require a name', () => {
			(() => {
				new Discovery();
			}).should.throw('Missing name parameter');
		});
		it('should require a Channel', () => {
			(() => {
				new Discovery('chaincode');
			}).should.throw('Missing channel parameter');
		});
		it('should create', () => {
			const discovery2 = new Discovery('chaincode', channel);
			discovery2.type.should.equal('Discovery');
		});
	});

	describe('#newHandler', () => {
		it('should return new handler', () => {
			const handler = discovery.newHandler();
			should.equal(handler.discovery.type, 'Discovery');
			should.equal(handler.discovery.name, 'mydiscovery');
		});
	});

	describe('#build', () => {
		it('should require a idContext', () => {
			(() => {
				discovery.build();
			}).should.throw('Missing idContext parameter');
		});
		it('should require an interest endorsement', () => {
			(() => {
				discovery.build(idx, {config: false});
			}).should.throw('No discovery interest provided');
		});
		it('should build with default options', () => {
			discovery.build(idx);
			should.exist(discovery._action);
			should.exist(discovery._payload);
		});
		it('should build with a config option', () => {
			discovery.build(idx, {config: true});
			should.exist(discovery._action);
			should.exist(discovery._payload);
		});
		it('should build with a local option', () => {
			discovery.build(idx, {local: true});
			should.exist(discovery._action);
			should.exist(discovery._payload);
		});
		it('should build with an endorsement option', () => {
			const endorsement = channel.newEndorsement('mychaincode');
			discovery.build(idx, {local: true, endorsement: endorsement});
			should.exist(discovery._action);
			should.exist(discovery._payload);
		});
		it('should build with an interest option', () => {
			const interest = [{name: 'mychaincode'}];
			discovery.build(idx, {local: true, interest: interest});
			should.exist(discovery._action);
			should.exist(discovery._payload);
		});
	});

	describe('#send', () => {
		it('throws if targets is missing', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			await discovery.send().should.be.rejectedWith('Missing targets parameter');
		});
		it('throws no results if targets is not missing', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			sinon.stub(discoverer, 'sendDiscovery').resolves({});
			await discovery.send({targets: [discoverer]}).should.be.rejectedWith('Discovery has failed to return results');
		});
		it('should be able to handle result error', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			sinon.stub(discoverer, 'sendDiscovery').resolves(new Error('forced error'));
			await discovery.send({targets: [discoverer]}).should.be.rejectedWith('forced error');
		});
		it('should be able to handle rejected error', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			sinon.stub(discoverer, 'sendDiscovery').rejects(new Error('forced error'));
			await discovery.send({targets: [discoverer]}).should.be.rejectedWith('forced error');
		});
		it('throws no results if results includes and error', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			sinon.stub(discoverer, 'sendDiscovery').resolves({results:[{result: 'error', error: {content: 'result error'}}]});
			await discovery.send({targets: [discoverer]}).should.be.rejectedWith('Discovery: mydiscovery error: result error');
		});
		it('handle results from config', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			endorser.name = 'peer1';
			sinon.stub(discoverer, 'sendDiscovery').resolves({results: [config_result]});
			const results = await discovery.send({targets: [discoverer]});
			should.exist(results.msps);
		});
		it('handle results from config if endorser exist', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			endorser.name = 'host.com:1000';
			channel.addEndorser(endorser);
			sinon.stub(discoverer, 'sendDiscovery').resolves({results: [config_result]});
			const results = await discovery.send({targets: [discoverer]});
			should.exist(results.msps);
		});
		it('handle results with members', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			endorser.name = 'peer2';
			sinon.stub(discoverer, 'sendDiscovery').resolves({results: [config_result, members]});
			const results = await discovery.send({targets: [discoverer]});
			should.exist(results.peers_by_org);
		});
		it('handle results with bad members', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			endorser.name = 'peer3';
			sinon.stub(discoverer, 'sendDiscovery').resolves({results: [config_result, bad_members]});
			const results = await discovery.send({targets: [discoverer]});
			should.exist(results.peers_by_org);

		});
		it('handle results with chaincode query res', async () => {
			discovery.build(idx);
			discovery.sign(idx);
			endorser.name = 'peer4';
			endorser.connect = sinon.stub().throws(new Error('bad connect'));
			sinon.stub(discoverer, 'sendDiscovery').resolves({results: [config_result, cc_query_res]});
			const results = await discovery.send({targets: [discoverer]});
			should.exist(results.endorsement_plan);
		});
	});

	describe('#getDiscoveryResults', async () => {
		it('should close no targets', async () => {
			await discovery.getDiscoveryResults().should.be.rejectedWith('No discovery results found');
		});
		it('should try to resend', async () => {
			discovery.discoveryResults = {};
			discovery.discoveryResults.timestamp = 0;
			discovery.send = sinon.stub().returns({});
			await discovery.getDiscoveryResults(true);
		});
		it('should not resend', async () => {
			discovery.discoveryResults = {not: true};
			discovery.send = sinon.stub().returns({});
			const results = await discovery.getDiscoveryResults();
			should.equal(results.not, true);
		});
	});

	describe('#close', () => {
		it('should close no targets', () => {
			discovery.close();
		});
		it('should close all targets', () => {
			discovery.targets = [discoverer];
			discovery.close();
		});
	});

	describe('#toString', () => {
		it('should return string', () => {
			const string = discovery.toString();
			should.equal(string, 'Discovery: {name: mydiscovery, channel: mychannel}');
		});
	});

	describe('#_buildProtoChaincodeInterest', () => {
		it('should handle no interest', () => {
			const results = discovery._buildProtoChaincodeInterest();
			should.exist(results.chaincodes);
		});
		it('should handle one chaincode', () => {
			const interest = [{name: 'chaincode1'}];
			const results = discovery._buildProtoChaincodeInterest(interest);
			should.exist(results.chaincodes);
		});
		it('should handle one chaincode one collection', () => {
			const interest = [{name: 'chaincode1', collection_names: ['collection1']}];
			const results = discovery._buildProtoChaincodeInterest(interest);
			should.exist(results.chaincodes);
		});
		it('should handle two chaincodes', () => {
			const interest = [{name: 'chaincode1'}, {name: 'chaincode2'}];
			const results = discovery._buildProtoChaincodeInterest(interest);
			should.exist(results.chaincodes);
		});
		it('should handle two chaincode two collection', () => {
			const interest = [
				{name: 'chaincode1', collection_names: ['collection1']},
				{name: 'chaincode2', collection_names: ['collection2']}
			];
			const results = discovery._buildProtoChaincodeInterest(interest);
			should.exist(results.chaincodes);
		});
		it('should handle two chaincode four collection', () => {
			const interest = [
				{name: 'chaincode1', collection_names: ['collection1', 'collection3']},
				{name: 'chaincode2', collection_names: ['collection2', 'collection4']}
			];
			const results = discovery._buildProtoChaincodeInterest(interest);
			should.exist(results.chaincodes);
		});
		it('should handle two chaincodes same name', () => {
			const interest = [{name: 'chaincode1'}, {name: 'chaincode1'}];
			const results = discovery._buildProtoChaincodeInterest(interest);
			should.exist(results.chaincodes);
		});
		it('should require a idContext', () => {
			(() => {
				const interest = [{name: {}}];
				discovery._buildProtoChaincodeInterest(interest);
			}).should.throw('Chaincode name must be a string');
		});
		it('should require a idContext', () => {
			(() => {
				const interest = [{name: 'chaincode1', collection_names: {}}];
				discovery._buildProtoChaincodeInterest(interest);
			}).should.throw('Collection names must be an array of strings');
		});
		it('should require a idContext', () => {
			(() => {
				const interest = [{name: 'chaincode1', collection_names: [{}]}];
				discovery._buildProtoChaincodeInterest(interest);
			}).should.throw('The collection name must be a string');
		});
	});

	describe('#_buildUrl', () => {
		it('should handle no parms', () => {
			(() => {
				discovery._buildUrl();
			}).should.throw('Missing hostname parameter');
		});
		it('should handle no parms', () => {
			(() => {
				discovery._buildUrl('hostname');
			}).should.throw('Missing port parameter');
		});
		it('should handle as localhost', () => {
			discovery.as_localhost = true;
			const results = discovery._buildUrl('hostname', 1000);
			should.equal(results, 'grpcs://localhost:1000');
		});
		it('should handle not as localhost', () => {
			discovery.as_localhost = false;
			const results = discovery._buildUrl('hostname', 1000);
			should.equal(results, 'grpcs://hostname:1000');
		});
		it('should handle current target as', () => {
			discovery._current_target = endorser;
			endorser.endpoint = endpoint;
			const results = discovery._buildUrl('hostname', 1000);
			should.equal(results, 'grpc://hostname:1000');
		});
		it('should handle override setting', () => {
			Client.setConfigSetting('discovery-override-protocol', 'grpcs');
			discovery._current_target = endorser;
			endorser.endpoint = endpoint;
			const results = discovery._buildUrl('hostname', 1000);
			should.equal(results, 'grpcs://hostname:1000');
		});
	});

	describe('#_buildTlsRootCerts', () => {
		it('should handle no parms', () => {
			(() => {
				discovery._buildTlsRootCerts();
			}).should.throw('Missing msp_id parameter');
		});
		it('should handle missing mspid when no msps', () => {
			const results = discovery._buildTlsRootCerts('msp1');
			should.equal(results, '');
		});
		it('should handle missing mspid when not in msps', () => {
			discovery.discoveryResults = {};
			discovery.discoveryResults.msps = {msp1: {
				id: 'msp1',
				name: 'msp1',
				tls_root_certs: 'root certs',
				tls_intermediate_certs: 'intermediate certs'
			}};
			const results = discovery._buildTlsRootCerts('bad');
			should.equal(results, '');
		});
		it('should handle mspid when in msps', () => {
			discovery.discoveryResults = {};
			discovery.discoveryResults.msps = {msp1: {
				id: 'msp1',
				name: 'msp1',
				tls_root_certs: 'rootcerts',
				tls_intermediate_certs: 'intermediatecerts'
			}};
			const results = discovery._buildTlsRootCerts('msp1');
			should.equal(results, 'rootcertsintermediatecerts');
		});
		it('should handle mspid when in msps and no certs', () => {
			discovery.discoveryResults = {};
			discovery.discoveryResults.msps = {msp1: {
				id: 'msp1',
				name: 'msp1'
			}};
			const results = discovery._buildTlsRootCerts('msp1');
			should.equal(results, '');
		});
	});
	describe('#_buildPeer', () => {
		it('should handle no parms', async () => {
			await discovery._buildPeer().should.be.rejectedWith('Missing discovery_peer parameter');
		});
		it('should handle found endorser on the channel', async () => {
			endorser.name = 'mypeer';
			channel.addEndorser(endorser);
			const results = await discovery._buildPeer({endpoint: 'mypeer'});
			should.equal(results, endorser);
		});
		it('should run', async () => {
			discovery.discoveryResults = {};
			discovery.discoveryResults.msps = {msp1: {
				id: 'msp1',
				name: 'msp1',
				tls_root_certs: 'rootcerts',
				tls_intermediate_certs: 'intermediatecerts'
			}};
			endorser.name = 'host2.com:1000';
			const results = await discovery._buildPeer({endpoint: 'host2.com:1000', name: 'host2.com:1000', mspid: 'msp1'});
			should.equal(results.name, 'host2.com:1000');
		});
		it('should handle endorser not connect', async () => {
			discovery.discoveryResults = {};
			discovery.discoveryResults.msps = {msp1: {
				id: 'msp1',
				name: 'msp1',
				tls_root_certs: 'rootcerts',
				tls_intermediate_certs: 'intermediatecerts'
			}};
			endorser.name = 'host3.com:1000';
			endorser.connect.throws(new Error('failed to connect'));
			const results = await discovery._buildPeer({endpoint: 'host3.com:1000', name: 'host3.com:1000', mspid: 'msp1'});
			should.equal(results.name, 'host3.com:1000');
		});
	});

	describe('#_processConfig', () => {
		it('should handle no parms', async () => {
			const results = await discovery._processConfig();
			should.exist(results.msps);
		});
		it('should handle no msps', async () => {
			const config = {
				orderers: {
					msp1: TestUtils.createEndpoints('hosta', 2),
					msp2: TestUtils.createEndpoints('hostb', 2)
				}
			};
			const results = await discovery._processConfig(config);
			should.exist(results.orderers);
		});
		it('should handle no msps', async () => {
			const config = {
				msps: {
					msp1: TestUtils.createMsp(),
					msp2: TestUtils.createMsp()
				}
			};
			const results = await discovery._processConfig(config);
			should.exist(results.msps);
		});
	});

	describe('#_processChaincode', () => {
		it('should throw error if plans are bad', async () => {
			await discovery._processChaincode().should.be.rejectedWith('Plan layouts are invalid');
		});
	});

	describe('#_processPeers', () => {
		it('should handle missing endorser state info', async () => {
			const q_peers = [
				{
					identity: TestUtils.createSerializedIdentity(),
					membership_info: {payload: TestUtils.createMembership()}
				}
			];
			await discovery._processPeers(q_peers);
		});
	});

	describe('#_processMembership', () => {
		it('should handle missing endorser by org', async () => {
			await discovery._processMembership({});
		});
	});
});
