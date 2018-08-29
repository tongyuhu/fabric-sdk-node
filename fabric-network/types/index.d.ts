/**
 * Copyright 2018 IBM All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { User } from 'fabric-client';

import Client = require('fabric-client');


//-------------------------------------------
// Main fabric network classes
//-------------------------------------------
export interface InitOptions {
	commitTimeout?: number;
	wallet: Wallet;
	identity: string;
	clientTlsIdentity?: string;
}

export class Network {
	constructor();
	initialize(ccp: string | Client, options?: InitOptions): Promise<void>;
	getCurrentIdentity(): User;
	getClient(): Client;
	getOptions(): InitOptions;
	getChannel(channelName: string): Promise<FabricNetwork.Channel>;
	dispose(): void;
}

// put into it's own separate namespace to avoid a clash with fabric-client Channel
declare namespace FabricNetwork {
	export class Channel {
		getInternalChannel(): Client.Channel;
		getPeerMap(): Map<string, Client.ChannelPeer[]>;
		getContract(chaincodeId: string): Contract;
		// will be coming
		// getEventHubs(): ChannelEventHub[];
	}
}

export class Contract {
	executeTransaction(transactionName: string, ...parameters: string[]): Promise<Buffer>;
	submitTransaction(transactionName: string, ...parameters: string[]): Promise<Buffer>;
}

//-------------------------------------------
// Wallet Management
//-------------------------------------------
export interface Identity {
	type: string
}

export interface X509Identity extends Identity {
	mspId: string,
	certificate: string,
	privateKey: string
}

export interface IdentityInformation {
	label: string,
	mspId: string,
	identifier: string
}

interface WalletAPI {
	import(label: string, identity: Identity): Promise<void>;
	export(label: string): Promise<Identity>;
	list(): Promise<IdentityInformation[]>;
	delete(label: string): Promise<void>;
	exists(label: string): Promise<boolean>;
}

interface Wallet extends WalletAPI {
}

interface WalletMixin {
}

declare abstract class BaseWallet implements Wallet {
	import(label: string, identity: Identity): Promise<void>;
	export(label: string): Promise<Identity>;
	list(): Promise<IdentityInformation[]>;
	abstract delete(label: string): Promise<void>;
	abstract exists(label: string): Promise<boolean>;
}

export class InMemoryWallet extends BaseWallet {
	constructor(mixin?: WalletMixin);
	delete(label: string): Promise<void>;
	exists(label: string): Promise<boolean>;
}

export class FileSystemWallet extends BaseWallet {
	constructor(path: string, mixin?: WalletMixin);
	delete(label: string): Promise<void>;
	exists(label: string): Promise<boolean>;
}

export class X509WalletMixin implements WalletMixin {
	constructor();
	static createIdentity(mspId: string, certificate: string, privateKey: string): X509Identity;
}